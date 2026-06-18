package com.battlesimulator

object NodeBridge {
    init {
        System.loadLibrary("node-bridge")
    }

    @JvmStatic external fun startNodeWithArguments(arguments: Array<String>, modulesPath: String): Int
    @JvmStatic external fun sendMessageToNode(channel: String, msg: String)
    @JvmStatic external fun registerDataDir(dataDir: String)

    // Called from C++ when Node.js sends a message to native (unused for now)
    @JvmStatic fun onMessageFromNode(channel: String, msg: String) {}
}
