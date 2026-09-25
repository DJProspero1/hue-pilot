package pt.prospero.huepilot

import com.google.common.truth.Truth.assertThat
import org.junit.Assert.assertThrows
import org.junit.Test
import pt.prospero.huepilot.domain.ScheduleBuilder

class ScheduleBuilderTest {
    @Test
    fun `every day when days omitted`() {
        assertThat(ScheduleBuilder.localtime("22:00")).isEqualTo("W127/T22:00:00")
        assertThat(ScheduleBuilder.localtime("22:00", emptyList())).isEqualTo("W127/T22:00:00")
    }

    @Test
    fun `weekday bitmask`() {
        assertThat(ScheduleBuilder.weekdayMask(listOf("mon"))).isEqualTo(64)
        assertThat(ScheduleBuilder.weekdayMask(listOf("sun"))).isEqualTo(1)
        assertThat(ScheduleBuilder.weekdayMask(listOf("mon", "tue", "wed", "thu", "fri"))).isEqualTo(124)
        assertThat(ScheduleBuilder.weekdayMask(listOf("Saturday", "SUNDAY"))).isEqualTo(3)
        assertThat(ScheduleBuilder.localtime("7:05", listOf("mon", "wed", "fri"))).isEqualTo("W84/T07:05:00")
    }

    @Test
    fun `one-time schedule`() {
        assertThat(ScheduleBuilder.localtime("07:30", null, "2026-01-31")).isEqualTo("2026-01-31T07:30:00")
    }

    @Test
    fun `invalid input is rejected`() {
        assertThrows(IllegalArgumentException::class.java) { ScheduleBuilder.localtime("25:00") }
        assertThrows(IllegalArgumentException::class.java) { ScheduleBuilder.localtime("nope") }
        assertThrows(IllegalArgumentException::class.java) { ScheduleBuilder.localtime("10:00", listOf("funday")) }
        assertThrows(IllegalArgumentException::class.java) { ScheduleBuilder.localtime("10:00", null, "31/01/2026") }
    }

    @Test
    fun `percent to bri`() {
        assertThat(ScheduleBuilder.percentToBri(100)).isEqualTo(254)
        assertThat(ScheduleBuilder.percentToBri(1)).isEqualTo(3)
        assertThat(ScheduleBuilder.percentToBri(50)).isEqualTo(127)
        assertThat(ScheduleBuilder.percentToBri(0)).isEqualTo(3)
    }

    @Test
    fun `v1 ids`() {
        assertThat(ScheduleBuilder.v1Id("/groups/3")).isEqualTo("3")
        assertThat(ScheduleBuilder.v1Id("/lights/7")).isEqualTo("7")
        assertThat(ScheduleBuilder.v1Id("/scenes/AbCdEf")).isEqualTo("AbCdEf")
        assertThat(ScheduleBuilder.v1Id(null)).isNull()
        assertThat(ScheduleBuilder.v1Id("")).isNull()
    }

    @Test
    fun `describe`() {
        assertThat(ScheduleBuilder.describe("W127/T22:00:00")).isEqualTo("Every day at 22:00")
        assertThat(ScheduleBuilder.describe("W124/T07:00:00")).isEqualTo("Weekdays at 07:00")
        assertThat(ScheduleBuilder.describe("W65/T07:00:00")).isEqualTo("Mon, Sun at 07:00")
        assertThat(ScheduleBuilder.describe("2026-01-31T07:30:00")).isEqualTo("Once on 2026-01-31 at 07:30")
    }
}
