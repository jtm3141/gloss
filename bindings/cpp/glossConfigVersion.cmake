# glossConfigVersion.cmake — SameMajorVersion compatibility for gloss 0.2.0.
#
# Compatible with any requested version in [0, 0.2.0] whose major component
# is 0. Major version 0 follows the pre-1.0 convention: 0.x releases are not
# API-compatible across minor bumps, so 0.3 would (correctly) not match.

set(PACKAGE_VERSION "0.2.0")

if(PACKAGE_VERSION VERSION_LESS PACKAGE_FIND_VERSION)
    # Asked for something newer than we are.
    set(PACKAGE_VERSION_COMPATIBLE FALSE)
else()
    string(REGEX MATCH "^([0-9]+)" _req_major "${PACKAGE_FIND_VERSION}")
    string(REGEX MATCH "^([0-9]+)" _this_major "${PACKAGE_VERSION}")
    if(_req_major STREQUAL _this_major)
        set(PACKAGE_VERSION_COMPATIBLE TRUE)
    else()
        set(PACKAGE_VERSION_COMPATIBLE FALSE)
    endif()
    unset(_req_major)
    unset(_this_major)
endif()

if(PACKAGE_VERSION STREQUAL PACKAGE_FIND_VERSION)
    set(PACKAGE_VERSION_EXACT TRUE)
endif()
