#include <jni.h>
#include <string>
#include <cstdlib>
#include <pthread.h>
#include <unistd.h>
#include <android/log.h>

#include "node.h"
#include "rn-bridge.h"

static JNIEnv* sEnv = nullptr;

// Pipe stdout/stderr to logcat
static int sPipeStdout[2], sPipeStderr[2];
static pthread_t sThreadStdout, sThreadStderr;
static const char* LOGTAG = "NODEJS-MOBILE";

static void* thread_stdout_func(void*) {
    ssize_t n; char buf[2048];
    while ((n = read(sPipeStdout[0], buf, sizeof buf - 1)) > 0) {
        if (buf[n-1] == '\n') --n;
        buf[n] = 0;
        __android_log_write(ANDROID_LOG_INFO, LOGTAG, buf);
    }
    return nullptr;
}
static void* thread_stderr_func(void*) {
    ssize_t n; char buf[2048];
    while ((n = read(sPipeStderr[0], buf, sizeof buf - 1)) > 0) {
        if (buf[n-1] == '\n') --n;
        buf[n] = 0;
        __android_log_write(ANDROID_LOG_ERROR, LOGTAG, buf);
    }
    return nullptr;
}
static void redirect_stdio_to_logcat() {
    setvbuf(stdout, nullptr, _IONBF, 0);
    pipe(sPipeStdout); dup2(sPipeStdout[1], STDOUT_FILENO);
    setvbuf(stderr, nullptr, _IONBF, 0);
    pipe(sPipeStderr); dup2(sPipeStderr[1], STDERR_FILENO);
    pthread_create(&sThreadStdout, nullptr, thread_stdout_func, nullptr);
    pthread_detach(sThreadStdout);
    pthread_create(&sThreadStderr, nullptr, thread_stderr_func, nullptr);
    pthread_detach(sThreadStderr);
}

// Callback from rn-bridge when Node.js sends a message to native
static void on_node_message(const char* channel, const char* msg) {
    JNIEnv* env = sEnv;
    if (!env) return;
    jclass cls = env->FindClass("com/battlesimulator/NodeBridge");
    if (!cls) return;
    jmethodID mid = env->GetStaticMethodID(cls, "onMessageFromNode",
        "(Ljava/lang/String;Ljava/lang/String;)V");
    if (mid) {
        jstring jch = env->NewStringUTF(channel);
        jstring jmsg = env->NewStringUTF(msg);
        env->CallStaticVoidMethod(cls, mid, jch, jmsg);
        env->DeleteLocalRef(jch);
        env->DeleteLocalRef(jmsg);
    }
    env->DeleteLocalRef(cls);
}

extern "C" JNIEXPORT void JNICALL
Java_com_battlesimulator_NodeBridge_sendMessageToNode(
        JNIEnv* env, jclass, jstring channel, jstring msg) {
    const char* ch  = env->GetStringUTFChars(channel, nullptr);
    const char* m   = env->GetStringUTFChars(msg, nullptr);
    rn_bridge_notify(ch, m);
    env->ReleaseStringUTFChars(channel, ch);
    env->ReleaseStringUTFChars(msg, m);
}

extern "C" JNIEXPORT void JNICALL
Java_com_battlesimulator_NodeBridge_registerDataDir(
        JNIEnv* env, jclass, jstring dataDir) {
    const char* path = env->GetStringUTFChars(dataDir, nullptr);
    rn_register_node_data_dir_path(path);
    env->ReleaseStringUTFChars(dataDir, path);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_battlesimulator_NodeBridge_startNodeWithArguments(
        JNIEnv* env, jclass, jobjectArray arguments, jstring modulesPath) {
    const char* path = env->GetStringUTFChars(modulesPath, nullptr);
    if (path && *path) setenv("NODE_PATH", path, 1);
    env->ReleaseStringUTFChars(modulesPath, path);

    jsize argc = env->GetArrayLength(arguments);
    int total = 0;
    for (int i = 0; i < argc; i++)
        total += strlen(env->GetStringUTFChars(
            (jstring)env->GetObjectArrayElement(arguments, i), nullptr)) + 1;

    char* buf = (char*)calloc(total, 1);
    char* argv[argc];
    char* pos = buf;
    for (int i = 0; i < argc; i++) {
        const char* s = env->GetStringUTFChars(
            (jstring)env->GetObjectArrayElement(arguments, i), nullptr);
        strncpy(pos, s, strlen(s));
        argv[i] = pos;
        pos += strlen(pos) + 1;
    }

    rn_register_bridge_cb(&on_node_message);
    sEnv = env;
    redirect_stdio_to_logcat();

    int rc = node::Start(argc, argv);
    free(buf);
    return rc;
}
