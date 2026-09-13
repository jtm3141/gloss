// Smoke test for gloss.hpp. Build (C files compiled as C, then linked):
//   gcc -O2 -c ../../core/sqlite3.c -o sqlite3.o -I../../core
//   gcc -O2 -c ../../core/gloss.c -o gloss.o -I../../core
//   g++ -O2 -std=c++17 -I../../core -o test_cpp test_cpp.cpp gloss.o sqlite3.o
// Run: ./test_cpp /path/to/gloss.db
#include <cassert>
#include <iostream>

#include "gloss.hpp"

int main(int argc, char **argv)
{
    const char *db_path = argc > 1 ? argv[1] : "../../data/gloss.db";
    gloss::Database db(db_path);

    auto def = db.define("dog");
    assert(def.has_value());
    assert(def->find("genus Canis") != std::string::npos);

    assert(!db.define("xyzzy").has_value());

    auto entry = db.lookup("dog");
    assert(entry.has_value());
    assert(!entry->senses.empty());
    assert(entry->senses[0].pos == "n");
    assert(entry->senses[0].sense_no == 1);
    assert(entry->senses[0].definition == *def);
    assert(!entry->senses[0].synonyms.empty());

    auto hyper = entry->senses[0].related(db, "@");
    assert(!hyper.empty());

    auto hits = db.search("dog", 5);
    bool found = false;
    for (auto &h : hits)
        if (h == "dog")
            found = true;
    assert(found);

    assert(!db.lookup("xyzzy").has_value());

    std::cout << "C++ binding smoke test: OK (" << entry->senses.size()
              << " senses for 'dog')" << std::endl;
    return 0;
}
