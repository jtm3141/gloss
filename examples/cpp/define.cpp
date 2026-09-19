// define.cpp — gloss C++ example: define, lookup, search, and related.
//
// This mirrors the `gloss` CLI verbs in miniature (see data/tiers/TIERS.md).
//
// Database resolution (explicit path wins; no tier logic in the wrapper —
// tier resolution lives in the CLI/Python/JS layers, and the C core is
// path-based per data/tiers/TIERS.md):
//   1. argv[1], if given;
//   2. the GLOSS_DB environment variable, if set;
//   3. data/tiers/gloss-tiny.db found relative to the gloss repo checkout
//      (i.e. <repo>/data/tiers/gloss-tiny.db) — handy for a quick offline
//      smoke test straight after building.
//
// Build (see README.md): cmake against an installed gloss prefix, then
//   ./gloss-define [path/to/gloss.db]
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <optional>

#include <gloss/gloss.hpp>

namespace fs = std::filesystem;

namespace {

// Repo-root-relative fallback: <repo>/data/tiers/gloss-tiny.db.
// argv[0] is <repo>/examples/cpp/build/gloss-define in a normal out-of-tree
// build, so walk up to the repo root and check there.
std::optional<std::string> tiny_db_next_to_repo(const char *argv0)
{
    std::error_code ec;
    fs::path exe = fs::canonical(fs::path(argv0), ec);
    if (ec)
        return std::nullopt;
    for (fs::path dir = exe.parent_path(); !dir.empty();
         dir = dir.parent_path()) {
        fs::path candidate = dir / "data" / "tiers" / "gloss-tiny.db";
        if (fs::is_regular_file(candidate, ec) && !ec)
            return candidate.string();
        if (dir == dir.parent_path())
            break;
    }
    return std::nullopt;
}

std::string resolve_db(int argc, char **argv)
{
    if (argc > 1)
        return argv[1];                       // explicit path wins
    if (const char *env = std::getenv("GLOSS_DB"); env && *env)
        return env;                           // GLOSS_DB second
    if (auto tiny = tiny_db_next_to_repo(argv[0]); tiny)
        return *tiny;                         // bundled tiny tier fallback
    std::cerr << "usage: " << argv[0]
              << " [path/to/gloss.db]  (or set GLOSS_DB)\n";
    std::exit(2);
}

} // namespace

int main(int argc, char **argv)
{
    const std::string db_path = resolve_db(argc, argv);
    std::cout << "gloss C++ example — database: " << db_path
              << " (wrapper v" << gloss::version() << ")\n\n";

    gloss::Database db(db_path);

    // gloss define dog — the single most common definition.
    auto def = db.define("dog");
    std::cout << "define(dog) = "
              << (def ? *def : std::string("<unknown word>")) << "\n\n";

    // gloss lookup dog — every sense, grouped n, v, a, r; sense_no ascending.
    if (auto entry = db.lookup("dog")) {
        std::cout << "lookup(dog): " << entry->senses.size() << " senses\n";
        for (const auto &s : entry->senses) {
            std::cout << "  " << s.pos << s.sense_no << " " << s.definition;
            if (!s.synonyms.empty())
                std::cout << "  [synonyms: " << s.synonyms.front()
                          << (s.synonyms.size() > 1 ? ", ..." : "") << "]";
            std::cout << "\n";
        }

        // gloss related dog @ — hypernyms of the most common sense.
        std::cout << "\nrelated(dog@n1, \"@\") — hypernyms:\n";
        auto hyper = entry->senses.front().related(db, "@");
        if (hyper.empty()) {
            std::cout << "  (none)\n";
        }
        for (const auto &r : hyper) {
            std::cout << "  ";
            for (const auto &w : r.words)
                std::cout << w << " ";
            std::cout << "— " << r.definition << "\n";
        }
    }

    // gloss suggest ser — autocomplete.
    std::cout << "\nsearch(\"ser\") suggestions:\n";
    for (const auto &w : db.search("ser", 8))
        std::cout << "  " << w << "\n";

    // Unknown words are nullopt, not an exception (see gloss.hpp contract).
    std::cout << "\ndefine(xyzzy) = "
              << (db.define("xyzzy") ? "???" : std::string("<unknown word>"))
              << "\n";

    return 0;
}
