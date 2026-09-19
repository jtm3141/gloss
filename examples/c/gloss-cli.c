/* gloss-cli.c — tiny example CLI over the gloss C99 core.
 *
 * Implements the tier-aware `gloss` command line from data/tiers/TIERS.md:
 *
 *   gloss-cli define WORD            most common definition
 *   gloss-cli suggest PREFIX         completions for a prefix
 *   gloss-cli related WORD [PTR]     relations of the most common sense
 *                                    (PTR defaults to "@"; "@" hypernym,
 *                                    "~" hyponym, "!" antonym, ...)
 *
 * Global flags (before the verb): --db PATH --tier NAME
 *
 * Database selection, in order:
 *   1. GLOSS_DB env var (explicit path, used as given),
 *   2. --db PATH flag,
 *   3. tier from --tier NAME, else GLOSS_TIER env, else "full",
 *      resolved by looking for gloss-<tier>.db in ./data/tiers/ then in
 *      the platform cache dir (~/.cache/gloss, ~/Library/Caches/gloss,
 *      or %LOCALAPPDATA%\gloss\Cache).
 *
 * This example never downloads: embedded targets bundle whichever tier
 * fits and pass its path directly (GLOSS_DB or --db). If the resolved
 * tier file is missing it prints a helpful error instead.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "gloss.h"

#define SUGGEST_LIMIT 10

static const char *TIERS[] = {"tiny", "small", "medium", "full"};

static int tier_is_valid(const char *tier)
{
    size_t i;
    for (i = 0; i < sizeof(TIERS) / sizeof(TIERS[0]); i++)
        if (strcmp(tier, TIERS[i]) == 0)
            return 1;
    return 0;
}

static int file_exists(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (f)
        fclose(f);
    return f != NULL;
}

/* Join dir + "/" + file into buf (buflen bytes). */
static void join_path(char *buf, size_t buflen, const char *dir,
                      const char *file)
{
    snprintf(buf, buflen, "%s/%s", dir, file);
}

/* Fill buf with the platform cache directory for gloss data. */
static void cache_dir(char *buf, size_t buflen)
{
    const char *home;
#ifdef _WIN32
    home = getenv("LOCALAPPDATA");
    if (home && *home) {
        snprintf(buf, buflen, "%s\\gloss\\Cache", home);
        return;
    }
#else
#ifdef __APPLE__
    home = getenv("HOME");
    if (home && *home) {
        snprintf(buf, buflen, "%s/Library/Caches/gloss", home);
        return;
    }
#else
    home = getenv("XDG_CACHE_HOME");
    if (home && *home) {
        join_path(buf, buflen, home, "gloss");
        return;
    }
    home = getenv("HOME");
    if (home && *home) {
        snprintf(buf, buflen, "%s/.cache/gloss", home);
        return;
    }
#endif
#endif
    buf[0] = '\0';
}

/* Print usage to stderr and exit 2. */
static void usage(const char *prog)
{
    fprintf(stderr,
            "usage: %s [--db PATH] [--tier tiny|small|medium|full] VERB ...\n"
            "  define WORD          most common definition\n"
            "  suggest PREFIX       completions for a prefix\n"
            "  related WORD [PTR]   relations of the most common sense\n"
            "                       (PTR defaults to \"@\"; see gloss.h)\n"
            "Database: GLOSS_DB env, else --db, else --tier/GLOSS_TIER\n"
            "  (default full), resolved from ./data/tiers/ or the\n"
            "  platform cache dir. gloss %s (version %s)\n",
            prog, "cli", GLOSS_VERSION_STRING);
    exit(2);
}

/* Resolve the database path into buf. Returns 0 on success, 1 on error
 * (message already printed). */
static int resolve_db(const char *db_flag, const char *tier_flag,
                      char *buf, size_t buflen)
{
    const char *explicit = getenv("GLOSS_DB");
    const char *tier;
    char fname[64];
    char rel[256];
    char cached[1024];

    if (explicit && *explicit) {
        snprintf(buf, buflen, "%s", explicit);
        return 0;
    }
    if (db_flag) {
        snprintf(buf, buflen, "%s", db_flag);
        return 0;
    }

    tier = tier_flag;
    if (!tier || !*tier)
        tier = getenv("GLOSS_TIER");
    if (!tier || !*tier)
        tier = "full";
    if (!tier_is_valid(tier)) {
        fprintf(stderr,
                "error: unknown tier \"%s\" (expected tiny, small, medium, full)\n",
                tier);
        return 1;
    }

    snprintf(fname, sizeof(fname), "gloss-%s.db", tier);

    /* 1. ./data/tiers/gloss-<tier>.db relative to the working directory */
    join_path(rel, sizeof(rel), "./data/tiers", fname);
    if (file_exists(rel)) {
        snprintf(buf, buflen, "%s", rel);
        return 0;
    }

    /* 2. the platform cache dir (where `gloss download` stores tiers) */
    cache_dir(cached, sizeof(cached));
    if (cached[0]) {
        join_path(rel, sizeof(rel), cached, fname);
        if (file_exists(rel)) {
            snprintf(buf, buflen, "%s", rel);
            return 0;
        }
    }

    /* 3. helpful error — this example never downloads. */
    fprintf(stderr,
            "error: could not find %s\n"
            "  looked in ./data/tiers/ and in %s\n"
            "  Fetch it first with the Python or JS package:\n"
            "    pip install gloss-dict && gloss download --tier %s\n"
            "  or point at any gloss.db directly:\n"
            "    GLOSS_DB=/path/to/gloss.db\n",
            fname, cached[0] ? cached : "(cache dir unavailable)", tier);
    return 1;
}

static int cmd_define(gloss_db_t *db, const char *word)
{
    char *def = gloss_define(db, word);
    if (!def) {
        fprintf(stderr, "error: unknown word \"%s\"\n", word);
        return 1;
    }
    printf("%s: %s\n", word, def);
    gloss_free_str(def);
    return 0;
}

static int cmd_suggest(gloss_db_t *db, const char *prefix)
{
    const char **words = gloss_search(db, prefix, SUGGEST_LIMIT);
    int i;
    if (!words) {
        fprintf(stderr, "error: search failed\n");
        return 1;
    }
    for (i = 0; words[i]; i++)
        printf("%s\n", words[i]);
    gloss_free_strarr(words);
    return 0;
}

static int cmd_related(gloss_db_t *db, const char *word, const char *ptr)
{
    gloss_entry_t *e = gloss_lookup(db, word);
    gloss_related_t *rels = NULL;
    int n, i, rc = 0;

    if (!e || e->nsenses == 0) {
        fprintf(stderr, "error: unknown word \"%s\"\n", word);
        if (e)
            gloss_free_entry(e);
        return 1;
    }
    /* most common sense: first sense returned by gloss_lookup */
    n = gloss_related(db, &e->senses[0], ptr, &rels);
    if (n == 0) {
        printf("%s: no \"%s\" relations\n", word, ptr);
    } else {
        printf("%s (%s%d): \"%s\" relations\n", word,
               e->senses[0].pos, e->senses[0].sense_no, ptr);
        for (i = 0; i < n; i++) {
            int j;
            for (j = 0; rels[i].words[j]; j++)
                printf("%s%s", j ? ", " : "  ", rels[i].words[j]);
            printf("\n    %s\n", rels[i].definition);
        }
    }
    gloss_free_related(rels, n);
    gloss_free_entry(e);
    return rc;
}

int main(int argc, char **argv)
{
    const char *prog = argc > 0 ? argv[0] : "gloss-cli";
    const char *db_flag = NULL;
    const char *tier_flag = NULL;
    const char *verb, *word, *ptr = "@";
    char path[4096];
    gloss_db_t *db;
    int i, rc;

    /* leading global flags */
    for (i = 1; i + 1 < argc; i += 2) {
        if (strcmp(argv[i], "--db") == 0)
            db_flag = argv[i + 1];
        else if (strcmp(argv[i], "--tier") == 0)
            tier_flag = argv[i + 1];
        else
            break;
    }
    if (i >= argc || strcmp(argv[i], "--help") == 0 ||
        strcmp(argv[i], "-h") == 0)
        usage(prog);
    if (strcmp(argv[i], "--version") == 0) {
        printf("gloss-cli %s\n", GLOSS_VERSION_STRING);
        return 0;
    }

    verb = argv[i];
    if (i + 1 >= argc) {
        fprintf(stderr, "error: %s needs a word\n", verb);
        usage(prog);
    }
    word = argv[i + 1];
    if (i + 2 < argc)
        ptr = argv[i + 2];
    if (i + 3 < argc)
        usage(prog);

    if (resolve_db(db_flag, tier_flag, path, sizeof(path)))
        return 1;

    db = gloss_open(path);
    if (!db) {
        fprintf(stderr, "error: could not open database \"%s\"\n", path);
        return 1;
    }

    if (strcmp(verb, "define") == 0)
        rc = cmd_define(db, word);
    else if (strcmp(verb, "suggest") == 0)
        rc = cmd_suggest(db, word);
    else if (strcmp(verb, "related") == 0)
        rc = cmd_related(db, word, ptr);
    else {
        fprintf(stderr, "error: unknown verb \"%s\"\n", verb);
        rc = 2;
    }

    gloss_close(db);
    return rc;
}
