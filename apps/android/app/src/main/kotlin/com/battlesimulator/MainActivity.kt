package com.battlesimulator

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.Locale

class MainActivity : AppCompatActivity(), TextToSpeech.OnInitListener {

    private lateinit var speechRecognizer: SpeechRecognizer
    private lateinit var tts: TextToSpeech

    private lateinit var micBtn: Button
    private lateinit var statusTv: TextView
    private lateinit var transcriptTv: TextView
    private lateinit var cmdNewGame: LinearLayout
    private lateinit var cmdResumeGame: LinearLayout

    private val http = OkHttpClient()
    private var isListening = false
    private var ttsReady = false
    private var sessionId: String? = null

    data class Command(val id: String, val phrase: String, val action: () -> Unit)

    private val commands by lazy {
        listOf(
            Command("new-game", "new game") { startNewGame() },
            Command("resume-game", "resume game") { resumeGame() },
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        micBtn = findViewById(R.id.mic_btn)
        statusTv = findViewById(R.id.status)
        transcriptTv = findViewById(R.id.transcript)
        cmdNewGame = findViewById(R.id.cmd_new_game)
        cmdResumeGame = findViewById(R.id.cmd_resume_game)

        tts = TextToSpeech(this, this)

        startForegroundService(Intent(this, NodeService::class.java))

        micBtn.isEnabled = false
        setStatus("Starting game server…")

        waitForServer()

        micBtn.setOnClickListener {
            if (isListening) stopListening() else startListening()
        }

        findViewById<Button>(R.id.speak_btn).setOnClickListener {
            speak("Attack!")
        }
    }

    private fun waitForServer() {
        lifecycleScope.launch {
            repeat(40) { attempt ->
                delay(500)
                try {
                    withContext(Dispatchers.IO) {
                        http.newCall(
                            Request.Builder()
                                .url("http://localhost:${NodeService.PORT}/games")
                                .get().build()
                        ).execute().close()
                    }
                    onServerReady()
                    return@launch
                } catch (_: Exception) {}
                if (attempt == 39) setStatus("Server failed to start", error = true)
            }
        }
    }

    private fun onServerReady() {
        setStatus("Server ready")
        checkMicPermission()
    }

    private fun checkMicPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED) {
            initSpeechRecognizer()
        } else {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 1)
        }
    }

    private fun initSpeechRecognizer() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            setStatus("Speech recognition not available on this device", error = true)
            return
        }
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this)
        speechRecognizer.setRecognitionListener(recognitionListener)
        micBtn.isEnabled = true
        setStatus("Tap to speak")
    }

    private fun startListening() {
        isListening = true
        micBtn.text = "■"
        micBtn.setBackgroundResource(R.drawable.btn_mic_recording)
        setStatus("Listening…")
        clearCommandHighlights()

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.ENGLISH.toLanguageTag())
        }
        speechRecognizer.startListening(intent)
    }

    private fun stopListening() {
        speechRecognizer.stopListening()
        resetMicButton()
    }

    private fun resetMicButton() {
        isListening = false
        micBtn.text = "🎤"
        micBtn.setBackgroundResource(R.drawable.btn_mic_idle)
    }

    private val recognitionListener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() { resetMicButton() }

        override fun onError(error: Int) {
            resetMicButton()
            val msg = when (error) {
                SpeechRecognizer.ERROR_NO_MATCH -> "No speech detected — tap to try again"
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Timed out — tap to try again"
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission denied"
                SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
                SpeechRecognizer.ERROR_NETWORK -> "Network error — is the offline language pack installed?"
                else -> "Error $error — tap to try again"
            }
            setStatus(msg, error = true)
        }

        override fun onResults(results: Bundle?) {
            resetMicButton()
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull() ?: return
            transcriptTv.text = text
            transcriptTv.setTextColor(getColor(R.color.transcript_text))
            matchCommand(text)
        }

        override fun onPartialResults(partialResults: Bundle?) {
            val text = partialResults
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull() ?: return
            transcriptTv.text = text
            transcriptTv.setTextColor(getColor(R.color.transcript_partial))
        }

        override fun onEvent(eventType: Int, params: Bundle?) {}
        override fun onSegmentResults(segmentResults: Bundle) {}
        override fun onEndOfSegmentedSession() {}
    }

    private fun matchCommand(text: String) {
        val normalized = text.lowercase().replace(Regex("[^a-z\\s]"), "").trim()
        clearCommandHighlights()
        val match = commands.find { normalized.contains(it.phrase) }
        if (match != null) {
            highlightCommand(match.id)
            setStatus("Command: \"${match.phrase}\"")
            match.action()
        } else {
            setStatus("No command matched — tap to try again")
        }
    }

    private fun highlightCommand(id: String) {
        val view = when (id) {
            "new-game" -> cmdNewGame
            "resume-game" -> cmdResumeGame
            else -> return
        }
        view.setBackgroundResource(R.drawable.cmd_bg_matched)
        view.findViewWithTag<TextView>("cmd-text")
            ?.setTextColor(getColor(R.color.cmd_matched_text))
    }

    private fun clearCommandHighlights() {
        listOf(cmdNewGame, cmdResumeGame).forEach { row ->
            row.setBackgroundResource(R.drawable.cmd_bg)
            row.findViewWithTag<TextView>("cmd-text")
                ?.setTextColor(getColor(R.color.cmd_text))
        }
    }

    private fun startNewGame() {
        lifecycleScope.launch {
            setStatus("Creating new game…")
            try {
                val body = """{"game":"chess","players":[{"id":"white","agent":"human"},{"id":"black","agent":"random"}]}"""
                val response = withContext(Dispatchers.IO) {
                    http.newCall(
                        Request.Builder()
                            .url("http://localhost:${NodeService.PORT}/sessions")
                            .post(body.toRequestBody("application/json".toMediaType()))
                            .build()
                    ).execute()
                }
                val json = JSONObject(response.body?.string() ?: "{}")
                sessionId = json.optString("id").takeIf { it.isNotEmpty() }
                if (sessionId != null) {
                    setStatus("Chess game started — you play White")
                    speak("New chess game started. You play White against a random AI.")
                } else {
                    setStatus("Failed to create session", error = true)
                }
            } catch (e: IOException) {
                setStatus("Server not ready — try again", error = true)
            }
        }
    }

    private fun resumeGame() {
        val id = sessionId
        if (id == null) {
            setStatus("No active session — say \"new game\" first")
            speak("No game in progress.")
            return
        }
        lifecycleScope.launch {
            try {
                val response = withContext(Dispatchers.IO) {
                    http.newCall(
                        Request.Builder()
                            .url("http://localhost:${NodeService.PORT}/sessions/$id")
                            .get().build()
                    ).execute()
                }
                val json = JSONObject(response.body?.string() ?: "{}")
                val turn = json.optInt("turn", 0)
                val status = json.optString("status", "active")
                val pending = json.optString("pendingPlayer", "")
                setStatus("Turn $turn · $status · pending: ${pending.ifEmpty { "none" }}")
                speak("It is turn $turn. ${if (pending.isNotEmpty()) "Waiting for $pending." else ""}")
            } catch (e: IOException) {
                setStatus("Failed to get game state", error = true)
            }
        }
    }

    private fun speak(text: String) {
        if (ttsReady) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "bs-${System.currentTimeMillis()}")
    }

    private fun setStatus(msg: String, error: Boolean = false) {
        runOnUiThread {
            statusTv.text = msg
            statusTv.setTextColor(
                getColor(if (error) R.color.status_error else R.color.status_normal)
            )
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts.language = Locale.US
            ttsReady = true
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            initSpeechRecognizer()
        } else {
            setStatus("Microphone permission required", error = true)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::speechRecognizer.isInitialized) speechRecognizer.destroy()
        tts.shutdown()
    }
}
