/* gloss.h — public API of the gloss C core.
 *
 * Phase 0 skeleton: the API shape is fixed so bindings can be written
 * against it; implementations land as the core is built out.
 *
 * Threading: a gloss_db_t handle is NOT thread-safe; use one per thread.
 * Memory: every string returned is owned by the handle or the entry —
 * do not free it yourself; gloss_free_entry() releases entries.
 */
#ifndef GLOSS_H
#define GLOSS_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct gloss_db gloss_db_t;
typedef struct gloss_entry gloss_entry_t;

/* Open a gloss.db built by data/build_db.py. Returns NULL on failure. */
gloss_db_t *gloss_open(const char *path);
void        gloss_close(gloss_db_t *db);

/* define: the single most common definition (sense #1). NULL if unknown. */
const char *gloss_define(gloss_db_t *db, const char *word);

/* lookup: the full entry. Free with gloss_free_entry(). */
gloss_entry_t *gloss_lookup(gloss_db_t *db, const char *word);
void           gloss_free_entry(gloss_entry_t *e);

/* Sense access on a looked-up entry. */
int         gloss_entry_sense_count(const gloss_entry_t *e);
const char *gloss_entry_definition(const gloss_entry_t *e, int sense_no); /* 1-based */
const char *gloss_entry_pos(const gloss_entry_t *e, int sense_no);

/* Relations of one sense: rel is a WNDB pointer symbol, e.g. "@" (hypernym),
 * "!" (antonym), "~" (hyponym), "#p" (part meronym). Returns a
 * NULL-terminated array of definition strings owned by the entry. */
const char **gloss_entry_related(const gloss_entry_t *e, int sense_no,
                                 const char *rel);

/* search: autocomplete over lemmas. Returns a NULL-terminated array of
 * lemma strings owned by the db; NULL on error. */
const char **gloss_search(gloss_db_t *db, const char *prefix, int limit);

#ifdef __cplusplus
}
#endif

#endif /* GLOSS_H */
