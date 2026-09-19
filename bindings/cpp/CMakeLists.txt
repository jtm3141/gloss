# gloss — C++ binding (header-only RAII wrapper over the C core).
#
# Provides the imported target `gloss::gloss` and installs:
#   <prefix>/include/gloss/gloss.hpp   (the wrapper)
#   <prefix>/include/gloss/gloss.h     (the C core header it includes)
#   <prefix>/lib/cmake/gloss/          (find_package support)
#
# By default the C core (core/gloss.c + core/sqlite3.c) is compiled into a
# private static library and linked transitively through gloss::gloss, so a
# consumer needs nothing but this package. Set GLOSS_CPP_USE_INSTALLED_C=ON
# to link an already-installed gloss C library instead.
cmake_minimum_required(VERSION 3.14)
project(gloss VERSION 0.2.0 LANGUAGES C CXX)

include(GNUInstallDirs)

option(GLOSS_CPP_USE_INSTALLED_C
       "Link an already-installed gloss C core instead of building core/gloss.c here"
       OFF)

# ---------------------------------------------------------------- C core ---
if(GLOSS_CPP_USE_INSTALLED_C)
    # A consumer that built/installed the C core separately can point us at it:
    #   -DGLOSS_C_LIBRARY=/path/to/libgloss.a
    find_library(GLOSS_C_LIBRARY NAMES gloss REQUIRED)
    add_library(gloss_c STATIC IMPORTED)
    set_target_properties(gloss_c PROPERTIES IMPORTED_LOCATION "${GLOSS_C_LIBRARY}")
    target_include_directories(gloss_c INTERFACE
        $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>)
else()
    add_library(gloss_c STATIC
        ../../core/gloss.c
        ../../core/sqlite3.c)
    target_include_directories(gloss_c PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/../../core>
        $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}/gloss>)
    # sqlite3.c is the vendored amalgamation; keep its build quiet and fast.
    if(MSVC)
        target_compile_options(gloss_c PRIVATE /O2)
    else()
        target_compile_options(gloss_c PRIVATE -O2 -w)
    endif()
endif()

# ------------------------------------------------------ C++ interface ----
add_library(gloss INTERFACE)
add_library(gloss::gloss ALIAS gloss)

target_include_directories(gloss INTERFACE
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}>
    $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>)

# gloss.hpp does #include "gloss.h"; the interface links the C core so a
# consumer's `target_link_libraries(foo PRIVATE gloss::gloss)` is sufficient.
target_link_libraries(gloss INTERFACE gloss_c)

# --------------------------------------------------------------- install ---
install(FILES gloss.hpp ../../core/gloss.h
        DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/gloss)

install(TARGETS gloss gloss_c
        EXPORT glossTargets
        INCLUDES DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})

install(EXPORT glossTargets
        FILE glossTargets.cmake
        NAMESPACE gloss::
        DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/gloss)

include(CMakePackageConfigHelpers)
configure_package_config_file(
    "${CMAKE_CURRENT_SOURCE_DIR}/glossConfig.cmake.in"
    "${CMAKE_CURRENT_BINARY_DIR}/glossConfig.cmake"
    INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/gloss)

install(FILES
        "${CMAKE_CURRENT_BINARY_DIR}/glossConfig.cmake"
        "${CMAKE_CURRENT_SOURCE_DIR}/glossConfigVersion.cmake"
        DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/gloss)

# ------------------------------------------------------------------ tests ---
option(GLOSS_CPP_BUILD_TESTS "Build the gloss.hpp smoke test" ON)
if(GLOSS_CPP_BUILD_TESTS)
    enable_testing()
    add_executable(test_cpp test_cpp.cpp)
    target_link_libraries(test_cpp PRIVATE gloss::gloss)
    target_compile_features(test_cpp PRIVATE cxx_std_17)
    add_test(NAME cpp_smoke
             COMMAND test_cpp "${CMAKE_CURRENT_SOURCE_DIR}/../../data/gloss.db")
endif()
