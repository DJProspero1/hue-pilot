package pt.prospero.huepilot

import androidx.datastore.preferences.core.mutablePreferencesOf
import androidx.datastore.preferences.core.preferencesOf
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.runBlocking
import org.junit.Test
import pt.prospero.huepilot.assistant.AssistantProvider
import pt.prospero.huepilot.data.settings.LegacyGeminiMigration
import pt.prospero.huepilot.data.settings.SettingsKeys
import pt.prospero.huepilot.data.settings.SettingsRepository

class SettingsMigrationTest {
    private val geminiKey = SettingsKeys.providerKey(AssistantProvider.GEMINI)
    private val geminiModel = SettingsKeys.providerModel(AssistantProvider.GEMINI)

    @Test
    fun `legacy gemini key and model move into the gemini slot`(): Unit = runBlocking {
        val legacy = preferencesOf(
            SettingsKeys.LEGACY_GEMINI_KEY to "AIza-old",
            SettingsKeys.LEGACY_GEMINI_MODEL to "gemini-2.0-flash",
            SettingsKeys.THEME to "DARK",
        )
        assertThat(LegacyGeminiMigration.shouldMigrate(legacy)).isTrue()
        val migrated = LegacyGeminiMigration.migrate(legacy)
        assertThat(migrated[geminiKey]).isEqualTo("AIza-old")
        assertThat(migrated[geminiModel]).isEqualTo("gemini-2.0-flash")
        assertThat(migrated[SettingsKeys.ASSISTANT_PROVIDER]).isEqualTo("gemini")
        assertThat(migrated.contains(SettingsKeys.LEGACY_GEMINI_KEY)).isFalse()
        assertThat(migrated.contains(SettingsKeys.LEGACY_GEMINI_MODEL)).isFalse()
        assertThat(migrated[SettingsKeys.THEME]).isEqualTo("DARK") // untouched
        assertThat(LegacyGeminiMigration.shouldMigrate(migrated)).isFalse()

        val settings = SettingsRepository.fromPreferences(migrated)
        assertThat(settings.assistantProvider).isEqualTo(AssistantProvider.GEMINI)
        assertThat(settings.activeConfig.apiKey).isEqualTo("AIza-old")
        assertThat(settings.activeConfig.model).isEqualTo("gemini-2.0-flash")
    }

    @Test
    fun `migration never overwrites values already stored in the new keys`() {
        val prefs = mutablePreferencesOf(
            SettingsKeys.LEGACY_GEMINI_KEY to "old",
            geminiKey to "new",
            SettingsKeys.ASSISTANT_PROVIDER to "openai",
        ).toPreferences()
        val migrated = LegacyGeminiMigration.migratePreferences(prefs)
        assertThat(migrated[geminiKey]).isEqualTo("new")
        assertThat(migrated[SettingsKeys.ASSISTANT_PROVIDER]).isEqualTo("openai")
        assertThat(migrated.contains(SettingsKeys.LEGACY_GEMINI_KEY)).isFalse()
    }

    @Test
    fun `fresh installs get defaults for every provider and unknown ids fall back to gemini`() {
        val fresh = SettingsRepository.fromPreferences(preferencesOf())
        assertThat(fresh.assistantProvider).isEqualTo(AssistantProvider.GEMINI)
        assertThat(fresh.providers.keys).containsExactlyElementsIn(AssistantProvider.entries)
        assertThat(fresh.provider(AssistantProvider.OPENAI).model).isEqualTo("gpt-5-mini")
        assertThat(fresh.provider(AssistantProvider.ANTHROPIC).model).isEqualTo("claude-opus-5")
        assertThat(fresh.provider(AssistantProvider.DEEPSEEK).model).isEqualTo("deepseek-chat")
        assertThat(fresh.provider(AssistantProvider.OPENROUTER).model).isEqualTo("google/gemini-2.5-flash")
        assertThat(fresh.provider(AssistantProvider.GEMINI).model).isEqualTo("gemini-2.5-flash")
        assertThat(fresh.providers.values.none { it.hasKey }).isTrue()

        val stored = SettingsRepository.fromPreferences(preferencesOf(
            SettingsKeys.ASSISTANT_PROVIDER to "anthropic",
            SettingsKeys.providerKey(AssistantProvider.ANTHROPIC) to "sk-ant",
            SettingsKeys.providerModel(AssistantProvider.ANTHROPIC) to "claude-sonnet-5",
            SettingsKeys.providerModel(AssistantProvider.OPENAI) to "",
        ))
        assertThat(stored.assistantProvider).isEqualTo(AssistantProvider.ANTHROPIC)
        assertThat(stored.activeConfig).isEqualTo(pt.prospero.huepilot.assistant.ProviderConfig("sk-ant", "claude-sonnet-5"))
        assertThat(stored.provider(AssistantProvider.OPENAI).model).isEqualTo("gpt-5-mini") // blank -> default

        val unknown = SettingsRepository.fromPreferences(preferencesOf(SettingsKeys.ASSISTANT_PROVIDER to "llama-farm"))
        assertThat(unknown.assistantProvider).isEqualTo(AssistantProvider.GEMINI)
    }

    @Test
    fun `provider metadata matches the suite contract`() {
        val byId = AssistantProvider.entries.associateBy { it.id }
        assertThat(byId.keys).containsExactly("gemini", "openai", "anthropic", "deepseek", "openrouter")
        assertThat(byId["gemini"]!!.keyUrl).isEqualTo("https://aistudio.google.com/apikey")
        assertThat(byId["openai"]!!.keyUrl).isEqualTo("https://platform.openai.com/api-keys")
        assertThat(byId["anthropic"]!!.keyUrl).isEqualTo("https://console.anthropic.com/settings/keys")
        assertThat(byId["deepseek"]!!.keyUrl).isEqualTo("https://platform.deepseek.com/api_keys")
        assertThat(byId["openrouter"]!!.keyUrl).isEqualTo("https://openrouter.ai/keys")
        assertThat(AssistantProvider.fromId(null)).isEqualTo(AssistantProvider.GEMINI)
    }
}
