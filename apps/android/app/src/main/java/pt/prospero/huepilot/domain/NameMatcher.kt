package pt.prospero.huepilot.domain

/** A named thing that the assistant can target (room, zone, light, scene). */
data class Named(val id: String, val name: String)

sealed class MatchResult<out T> {
    data class Found<T>(val item: T) : MatchResult<T>()
    data class Ambiguous<T>(val candidates: List<T>) : MatchResult<T>()
    data class NotFound<T>(val available: List<T>) : MatchResult<T>()
}

/**
 * Case-insensitive fuzzy name matching shared by all assistant tools.
 * Priority: id match > exact > starts-with > contains > word overlap.
 */
object NameMatcher {
    private fun norm(s: String) = s.trim().lowercase().replace(Regex("\\s+"), " ")

    private fun words(s: String) = norm(s).split(Regex("[^a-z0-9]+")).filter { it.isNotBlank() }.toSet()

    fun <T> match(query: String?, items: List<T>, name: (T) -> String, id: (T) -> String): MatchResult<T> {
        val q = norm(query ?: "")
        if (q.isEmpty() || items.isEmpty()) return MatchResult.NotFound(items)
        items.filter { id(it).lowercase() == q }.let { if (it.size == 1) return MatchResult.Found(it.first()) }
        val exact = items.filter { norm(name(it)) == q }
        if (exact.size == 1) return MatchResult.Found(exact.first())
        if (exact.size > 1) return MatchResult.Ambiguous(exact)
        val starts = items.filter { norm(name(it)).startsWith(q) }
        if (starts.size == 1) return MatchResult.Found(starts.first())
        if (starts.size > 1) return MatchResult.Ambiguous(starts)
        val contains = items.filter { norm(name(it)).contains(q) || q.contains(norm(name(it))) }
        if (contains.size == 1) return MatchResult.Found(contains.first())
        if (contains.size > 1) return MatchResult.Ambiguous(contains)
        val qWords = words(q)
        val scored = items.map { it to words(name(it)).intersect(qWords).size }.filter { it.second > 0 }
        if (scored.isEmpty()) return MatchResult.NotFound(items)
        val best = scored.maxOf { it.second }
        val top = scored.filter { it.second == best }.map { it.first }
        return if (top.size == 1) MatchResult.Found(top.first()) else MatchResult.Ambiguous(top)
    }

    fun match(query: String?, items: List<Named>): MatchResult<Named> = match(query, items, { it.name }, { it.id })
}
