# CMakeLists.txt — installable build of the gloss C99 core.
#
#   cmake -S core -B build -DCMAKE_BUILD_TYPE=Release
#   cmake --build build
#   cmake --install build --prefix /usr/local
#
# Produces a static libgloss.a, installs gloss.h and a gloss.pc
# pkg-config file. sqlite3.c is compiled in privately; it is NOT
# installed (use the drop-in source build in this directory if you
# want to see/vendor the amalgamation yourself).
#
# Works both as add_subdirectory(core) and standalone
# (cmake -S <path-to-this-dir>).

cmake_minimum_required(VERSION 3.15)

# Keep the library version in one place: it must match the
# GLOSS_VERSION_* macros at the top of gloss.h.
project(gloss VERSION 0.2.0 LANGUAGES C)

include(GNUInstallDirs)

add_library(gloss STATIC gloss.c sqlite3.c)
add_library(gloss::gloss ALIAS gloss)

# sqlite3.h is used only while compiling gloss.c (PRIVATE). gloss.h must
# be visible to consumers (BUILD_INTERFACE only — never INSTALL_INTERFACE,
# since the amalgamation stays bundled privately).
target_include_directories(gloss
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}
    PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>)
target_compile_features(gloss PRIVATE c_std_99)

# Version info on the installed artifacts.
set_target_properties(gloss PROPERTIES
    VERSION ${PROJECT_VERSION}
    SOVERSION ${PROJECT_VERSION_MAJOR}
    OUTPUT_NAME gloss)

if(WIN32)
    # static archives need no special link libs on Windows
else()
    target_link_libraries(gloss PRIVATE ${CMAKE_DL_LIBS} m)
endif()

install(TARGETS gloss
    EXPORT glossTargets
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR})
install(FILES gloss.h
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})

# pkg-config file for `pkg-config --cflags --libs gloss`.
configure_file(gloss.pc.in gloss.pc @ONLY)
install(FILES ${CMAKE_CURRENT_BINARY_DIR}/gloss.pc
    DESTINATION ${CMAKE_INSTALL_LIBDIR}/pkgconfig)

install(EXPORT glossTargets
    NAMESPACE gloss::
    FILE gloss-targets.cmake
    DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/gloss)
