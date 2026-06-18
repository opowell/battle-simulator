package com.battlesimulator

import android.app.*
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.io.File
import java.io.FileOutputStream

class NodeService : Service() {

    companion object {
        const val CHANNEL_ID = "battle_sim_node"
        const val NOTIF_ID = 1
        const val PORT = 3333
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification())
        Thread(::startNode, "nodejs-thread").start()
    }

    private fun startNode() {
        val nodeDir = File(filesDir, "nodejs-project")
        copyAssetsIfNeeded(nodeDir)
        NodeBridge.registerDataDir(nodeDir.absolutePath)
        // Runs api-server.js; import.meta.url resolves relative to the absolute path
        NodeBridge.startNodeWithArguments(
            arrayOf("node", File(nodeDir, "api-server.js").absolutePath),
            ""
        )
    }

    private fun copyAssetsIfNeeded(destDir: File) {
        if (destDir.exists()) return
        copyAssetFolder("nodejs-project", destDir)
    }

    private fun copyAssetFolder(assetPath: String, destFile: File) {
        val children = assets.list(assetPath)
        if (!children.isNullOrEmpty()) {
            destFile.mkdirs()
            for (child in children) {
                copyAssetFolder("$assetPath/$child", File(destFile, child))
            }
        } else {
            destFile.parentFile?.mkdirs()
            try {
                assets.open(assetPath).use { input ->
                    FileOutputStream(destFile).use { input.copyTo(it) }
                }
            } catch (_: Exception) {}
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Game Server", NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Battle Simulator API server" }
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Battle Simulator")
            .setContentText("Game server running on port $PORT")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY
}
