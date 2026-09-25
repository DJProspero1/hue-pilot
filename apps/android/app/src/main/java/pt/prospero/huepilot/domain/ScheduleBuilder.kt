package pt.prospero.huepilot.domain

/** Builds Hue v1 schedule `localtime` strings. */
object ScheduleBuilder {
    private val dayBits = mapOf(
        "mon" to 64, "tue" to 32, "wed" to 16, "thu" to 8, "fri" to 4, "sat" to 2, "sun" to 1,
    )

    private val timeRegex = Regex("^(\\d{1,2}):(\\d{2})(?::(\\d{2}))?$")
    private val dateRegex = Regex("^\\d{4}-\\d{2}-\\d{2}$")

    /** Normalises "7:5" -> "07:05:00", validates ranges. */
    fun normalizeTime(time: String): String {
        val m = timeRegex.find(time.trim()) ?: throw IllegalArgumentException("time must be HH:MM")
        val h = m.groupValues[1].toInt()
        val min = m.groupValues[2].toInt()
        val s = m.groupValues[3].ifEmpty { "0" }.toInt()
        require(h in 0..23 && min in 0..59 && s in 0..59) { "time out of range" }
        return "%02d:%02d:%02d".format(h, min, s)
    }

    /** Mon=64 ... Sun=1; empty/null -> 127 (every day). */
    fun weekdayMask(days: List<String>?): Int {
        if (days.isNullOrEmpty()) return 127
        var mask = 0
        for (d in days) {
            val key = d.trim().lowercase().take(3)
            val bit = dayBits[key] ?: throw IllegalArgumentException("unknown day: $d")
            mask = mask or bit
        }
        return if (mask == 0) 127 else mask
    }

    /**
     * Recurring: "W127/T22:00:00". One-time: "2026-01-31T07:30:00".
     */
    fun localtime(time: String, days: List<String>? = null, onceDate: String? = null): String {
        val t = normalizeTime(time)
        if (!onceDate.isNullOrBlank()) {
            require(dateRegex.matches(onceDate.trim())) { "once_date must be YYYY-MM-DD" }
            return "${onceDate.trim()}T$t"
        }
        return "W${weekdayMask(days)}/T$t"
    }

    /** Percent 1..100 -> v1 bri 1..254. */
    fun percentToBri(percent: Number): Int {
        val p = percent.toDouble().coerceIn(1.0, 100.0)
        return Math.round(p / 100.0 * 254.0).toInt().coerceIn(1, 254)
    }

    /** "/groups/3" -> "3", "/lights/7" -> "7", "/scenes/AbCdEf" -> "AbCdEf". */
    fun v1Id(idV1: String?): String? = idV1?.trim()?.trimEnd('/')?.substringAfterLast('/')?.takeIf { it.isNotEmpty() }

    /** Human readable description of a localtime for the UI. */
    fun describe(localtime: String?): String {
        if (localtime == null) return ""
        val weekly = Regex("^W(\\d+)/T(\\d{2}:\\d{2})(?::\\d{2})?$").find(localtime)
        if (weekly != null) {
            val mask = weekly.groupValues[1].toInt()
            val time = weekly.groupValues[2]
            val names = listOf("Mon" to 64, "Tue" to 32, "Wed" to 16, "Thu" to 8, "Fri" to 4, "Sat" to 2, "Sun" to 1)
            val days = names.filter { mask and it.second != 0 }.map { it.first }
            val label = when {
                mask == 127 -> "Every day"
                mask == 124 -> "Weekdays"
                mask == 3 -> "Weekends"
                else -> days.joinToString(", ")
            }
            return "$label at $time"
        }
        val once = Regex("^(\\d{4}-\\d{2}-\\d{2})T(\\d{2}:\\d{2})").find(localtime)
        if (once != null) return "Once on ${once.groupValues[1]} at ${once.groupValues[2]}"
        return localtime
    }
}
