package pt.prospero.huepilot

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import pt.prospero.huepilot.domain.MatchResult
import pt.prospero.huepilot.domain.NameMatcher
import pt.prospero.huepilot.domain.Named

class NameMatcherTest {
    private val rooms = listOf(
        Named("1", "Living room"),
        Named("2", "Office"),
        Named("3", "Bedroom"),
        Named("4", "Kids bedroom"),
        Named("5", "Kitchen"),
        Named("6", "Hallway upstairs"),
        Named("7", "Hallway downstairs"),
    )

    private fun found(r: MatchResult<Named>) = (r as MatchResult.Found).item

    @Test
    fun `exact match is case insensitive`() {
        assertThat(found(NameMatcher.match("office", rooms)).id).isEqualTo("2")
        assertThat(found(NameMatcher.match("  LIVING ROOM ", rooms)).id).isEqualTo("1")
    }

    @Test
    fun `exact beats starts-with`() {
        // "Bedroom" exactly matches id 3 even though "Kids bedroom" contains it.
        assertThat(found(NameMatcher.match("bedroom", rooms)).id).isEqualTo("3")
    }

    @Test
    fun `starts-with match`() {
        assertThat(found(NameMatcher.match("kit", rooms)).id).isEqualTo("5")
    }

    @Test
    fun `contains match`() {
        assertThat(found(NameMatcher.match("kids", rooms)).id).isEqualTo("4")
    }

    @Test
    fun `word overlap match`() {
        assertThat(found(NameMatcher.match("the upstairs one", rooms)).id).isEqualTo("6")
    }

    @Test
    fun `ambiguous returns candidates`() {
        val r = NameMatcher.match("hallway", rooms)
        assertThat(r).isInstanceOf(MatchResult.Ambiguous::class.java)
        assertThat((r as MatchResult.Ambiguous).candidates.map { it.id }).containsExactly("6", "7")
    }

    @Test
    fun `not found returns available list`() {
        val r = NameMatcher.match("garage", rooms)
        assertThat(r).isInstanceOf(MatchResult.NotFound::class.java)
        assertThat((r as MatchResult.NotFound).available).hasSize(rooms.size)
    }

    @Test
    fun `ids are accepted`() {
        assertThat(found(NameMatcher.match("7", rooms)).name).isEqualTo("Hallway downstairs")
    }

    @Test
    fun `empty query is not found`() {
        assertThat(NameMatcher.match("", rooms)).isInstanceOf(MatchResult.NotFound::class.java)
        assertThat(NameMatcher.match(null, rooms)).isInstanceOf(MatchResult.NotFound::class.java)
    }
}
