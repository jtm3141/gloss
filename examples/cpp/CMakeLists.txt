# Consumer-side example: builds against an *installed* gloss package via
# find_package, exactly the way a downstream project would use it.
#
#   cmake -S . -B build -DCMAKE_PREFIX_PATH=<gloss-install-prefix>
#   cmake --build build
#   build/gloss-define /path/to/gloss.db
cmake_minimum_required(VERSION 3.14)
project(gloss-cpp-example LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The gloss package installs gloss::gloss (header-only RAII wrapper with the
# C core linked in transitively). Version 0.2 or newer required.
find_package(gloss 0.2 CONFIG REQUIRED)

add_executable(gloss-define define.cpp)
target_link_libraries(gloss-define PRIVATE gloss::gloss)
