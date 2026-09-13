/* gloss.c — the gloss C99 core.
 *
 * Phase 0 skeleton: API shape only. Each function gets a real
 * implementation against gloss.db (SQLite) as the core is built out,
 * with conformance fixtures in data/ keeping every binding honest.
 */
#include "gloss.h"

#include <stddef.h>

struct gloss_db {
    int placeholder; /* TODO: sqlite3 handle */
};

struct gloss_entry {
    int placeholder; /* TODO: fetched senses + relations */
};

gloss_db_t *gloss_open(const char *path)
{
    (void)path;
    return NULL; /* TODO */
}

void gloss_close(gloss_db_t *db)
{
    (void)db; /* TODO */
}

const char *gloss_define(gloss_db_t *db, const char *word)
{
    (void)db;
    (void)word;
    return NULL; /* TODO */
}

gloss_entry_t *gloss_lookup(gloss_db_t *db, const char *word)
{
    (void)db;
    (void)word;
    return NULL; /* TODO */
}

void gloss_free_entry(gloss_entry_t *e)
{
    (void)e; /* TODO */
}

int gloss_entry_sense_count(const gloss_entry_t *e)
{
    (void)e;
    return 0; /* TODO */
}

const char *gloss_entry_definition(const gloss_entry_t *e, int sense_no)
{
    (void)e;
    (void)sense_no;
    return NULL; /* TODO */
}

const char *gloss_entry_pos(const gloss_entry_t *e, int sense_no)
{
    (void)e;
    (void)sense_no;
    return NULL; /* TODO */
}

const char **gloss_entry_related(const gloss_entry_t *e, int sense_no,
                                 const char *rel)
{
    (void)e;
    (void)sense_no;
    (void)rel;
    return NULL; /* TODO */
}

const char **gloss_search(gloss_db_t *db, const char *prefix, int limit)
{
    (void)db;
    (void)prefix;
    (void)limit;
    return NULL; /* TODO */
}
