// Smoke test for gloss.hpp. Build (C files compiled as C, then linked):
//   gcc -O2 -c ../../core/sqlite3.c -o sqlite3.o -I../../core
//   gcc -O2 -c ../../core/gloss.c -o gloss.o -I../../core
//   g++ -O2 -std=c++17 -I../../core -o test_cpp test_cpp.cpp gloss.o sqlite3.o
// Run: ./test_cpp /path/to/gloss.db
#include <cassert>
#include <iostream>
#include <stdexcept>
#include <string>

#include "gloss.hpp"

int main(int argc, char **argv)
{
    const char *db_path = argc > 1 ? argv[1] : "../../data/gloss.db";

    // Version metadata matches the binding release.
    assert(gloss::version() == "0.2.0");
    assert(gloss::version_major == 0 && gloss::version_minor == 2 &&
           gloss::version_patch == 0);

    // Open failure throws gloss::error (part of the documented contract).
    bool threw = false;
    try {
        gloss::Database bad("/nonexistent/gloss.db");
    } catch (const gloss::error &) {
        threw = true;
    }
    assert(threw);

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

    // Conformance: lookup groups n, v, a, r; sense_no ascending within POS.
    {
        const std::string pos_order = "nvar";
        int last_rank = -1, last_no = 0;
        for (const auto &s : entry->senses) {
            assert(!s.pos.empty());
            int rank = static_cast<int>(pos_order.find(s.pos[0]));
            assert(rank != static_cast<int>(std::string::npos));
            assert(rank >= last_rank);
            if (rank == last_rank)
                assert(s.sense_no > last_no);
            last_rank = rank;
            last_no = s.sense_no;
        }
    }

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
