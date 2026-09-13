/* gloss.h — public API of the gloss C99 core.
 *
 * gloss is a dictionary engine: gloss.db (SQLite, built from Open English
 * WordNet by data/build_db.py) holds the data; this library owns all query
 * logic. Every language binding is a thin wrapper over this API.
 *
 * Memory: anything returned is owned by the caller and must be released
 * with the matching gloss_free_* function. A gloss_db_t handle is NOT
 * thread-safe; use one handle per thread.
 */
#ifndef GLOSS_H
#define GLOSS_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct gloss_db gloss_db_t;

/* One word sense. */
typedef struct {
    char *pos;            /* "n", "v", "a" or "r" */
    int   sense_no;       /* 1-based, frequency order */
    long  synset_offset;  /* internal coordinate, for gloss_related() */
    char *synset_pos;     /* pos code of the synset */
    char *definition;
    char **examples;      /* NULL-terminated array */
    char **synonyms;      /* NULL-terminated; excludes the query word */
} gloss_sense_t;

/* A full lookup result: every sense of the word. */
typedef struct {
    char *word;           /* as queried */
    int   nsenses;
    gloss_sense_t *senses;
} gloss_entry_t;

/* One related synset (hypernym, antonym, ...). */
typedef struct {
    char **words;         /* NULL-terminated, synset word order */
    char *definition;
} gloss_related_t;

/* Open a gloss.db (read-only). Returns NULL on failure. */
gloss_db_t *gloss_open(const char *path);
void        gloss_close(gloss_db_t *db);

/* The single most common definition: POS tried in order n, v, a, r,
 * sense #1 wins. The word is tried as given, then lowercased (data files
 * keep original case: "French leave"). Returns NULL for unknown words.
 * Free with gloss_free_str. */
char *gloss_define(gloss_db_t *db, const char *word);
void  gloss_free_str(char *s);

/* Full entry: all senses (n, then v, a, r; sense_no ascending).
 * Word tried as given, then lowercased.
 * Returns NULL for unknown words. Free with gloss_free_entry. */
gloss_entry_t *gloss_lookup(gloss_db_t *db, const char *word);
void           gloss_free_entry(gloss_entry_t *e);

/* Related synsets for one sense. rel is a WNDB pointer symbol:
 * "!" antonym, "@" hypernym, "~" hyponym, "#p" part meronym, ... Returns
 * the count (0 if none); *out receives a caller-owned array, free it with
 * gloss_free_related (even when the count is 0 and *out is NULL — safe). */
int  gloss_related(gloss_db_t *db, const gloss_sense_t *sense,
                   const char *rel, gloss_related_t **out);
void gloss_free_related(gloss_related_t *rels, int n);

/* Autocomplete: up to `limit` distinct lemmas starting with prefix,
 * alphabetical. NULL-terminated; free with gloss_free_strarr. */
const char **gloss_search(gloss_db_t *db, const char *prefix, int limit);
void         gloss_free_strarr(const char **arr);

#ifdef __cplusplus
}
#endif

#endif /* GLOSS_H */
