cmake_minimum_required(VERSION 3.18)
project(battlesimulator)

add_library(node-bridge SHARED
    node-bridge.cpp
    rn-bridge.cpp)

include_directories(libnode/include/node/)

add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES IMPORTED_LOCATION
    ${CMAKE_SOURCE_DIR}/libnode/bin/${ANDROID_ABI}/libnode.so)

find_library(log-lib log)

target_link_libraries(node-bridge libnode ${log-lib})
