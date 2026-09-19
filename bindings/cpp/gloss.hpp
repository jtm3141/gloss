// gloss.hpp — header-only C++ wrapper over the gloss C core.
//
//   gloss::Database db("data/gloss.db");
//   std::cout << db.define("dog") << "\n";
//   for (auto &sense : db.lookup("dog").senses) { ... }
//
// ---------------------------------------------------------------------------
// Exception contract
//
// Throws gloss::error on misuse:
//   - Database(path) throws if the database cannot be opened (missing file,
//     not a gloss.db, unreadable). The C core is read-only; a bad path is
//     the only failure mode.
//   - Sense::related() throws std::out_of_range (via std::vector) only if
//     the Sense's relation coordinates are garbage — in practice they always
//     come from Database::lookup(), so this does not happen in normal use.
//
// Returns without throwing on missing data:
//   - define()/lookup() return std::nullopt for an unknown word.
//   - search() returns an empty vector when nothing matches the prefix.
//   - Sense::related() returns an empty vector when the sense has no such
//     relations.
//
// No other exceptions are thrown by this wrapper; the C core reports every
// lookup miss as NULL/0 and the wrapper maps those to nullopt/empty.
// ---------------------------------------------------------------------------
#pragma once

#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include "gloss.h"

namespace gloss {

// Wrapper version. Tracks the binding release, not the database edition
// (the OEWN edition is stamped inside each .db's meta table).
inline constexpr int version_major = 0;
inline constexpr int version_minor = 2;
inline constexpr int version_patch = 0;

inline std::string version()
{
    return std::to_string(version_major) + "." +
           std::to_string(version_minor) + "." +
           std::to_string(version_patch);
}

class error : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

namespace detail {
struct DbDeleter {
    void operator()(gloss_db_t *p) const noexcept { gloss_close(p); }
};
} // namespace detail

struct Related {
    std::vector<std::string> words;
    std::string definition;
};

struct Sense {
    std::string pos;
    int sense_no = 0;
    std::string definition;
    std::vector<std::string> examples;
    std::vector<std::string> synonyms;
    // Coordinates for related(); filled by lookup().
    long synset_offset = 0;
    std::string synset_pos;

    std::vector<Related> related(class Database &db, const std::string &rel) const;
};

struct Entry {
    std::string word;
    std::vector<Sense> senses;
};

class Database {
public:
    explicit Database(const std::string &path)
        : db_(gloss_open(path.c_str()))
    {
        if (!db_)
            throw error("gloss: cannot open database: " + path);
    }

    std::optional<std::string> define(const std::string &word)
    {
        char *raw = gloss_define(db_.get(), word.c_str());
        if (!raw)
            return std::nullopt;
        std::string out(raw);
        gloss_free_str(raw);
        return out;
    }

    std::optional<Entry> lookup(const std::string &word)
    {
        gloss_entry_t *raw = gloss_lookup(db_.get(), word.c_str());
        if (!raw)
            return std::nullopt;
        Entry e;
        e.word = raw->word ? raw->word : "";
        for (int i = 0; i < raw->nsenses; i++) {
            const gloss_sense_t &s = raw->senses[i];
            Sense sn;
            sn.pos = s.pos ? s.pos : "";
            sn.sense_no = s.sense_no;
            sn.definition = s.definition ? s.definition : "";
            sn.synset_offset = s.synset_offset;
            sn.synset_pos = s.synset_pos ? s.synset_pos : "";
            for (char **p = s.examples; p && *p; p++)
                sn.examples.emplace_back(*p);
            for (char **p = s.synonyms; p && *p; p++)
                sn.synonyms.emplace_back(*p);
            e.senses.push_back(std::move(sn));
        }
        gloss_free_entry(raw);
        return e;
    }

    std::vector<std::string> search(const std::string &prefix, int limit = 10)
    {
        const char **raw = gloss_search(db_.get(), prefix.c_str(), limit);
        std::vector<std::string> out;
        if (raw) {
            for (const char **p = raw; *p; p++)
                out.emplace_back(*p);
            gloss_free_strarr(raw);
        }
        return out;
    }

    // Low-level escape hatch for Sense::related().
    gloss_db_t *handle() noexcept { return db_.get(); }

private:
    std::unique_ptr<gloss_db_t, detail::DbDeleter> db_;
};

inline std::vector<Related> Sense::related(Database &db, const std::string &rel) const
{
    gloss_sense_t s{};
    s.pos = const_cast<char *>(pos.c_str());
    s.sense_no = sense_no;
    s.synset_offset = synset_offset;
    s.synset_pos = const_cast<char *>(synset_pos.c_str());

    gloss_related_t *raw = nullptr;
    int n = gloss_related(db.handle(), &s, rel.c_str(), &raw);
    std::vector<Related> out;
    for (int i = 0; i < n; i++) {
        Related r;
        r.definition = raw[i].definition ? raw[i].definition : "";
        for (char **p = raw[i].words; p && *p; p++)
            r.words.emplace_back(*p);
        out.push_back(std::move(r));
    }
    gloss_free_related(raw, n);
    return out;
}

} // namespace gloss
