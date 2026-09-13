/* gloss.c — the gloss C99 core.
 *
 * Query logic over gloss.db (SQLite). Boring, careful, dependency-light:
 * the only dependency is the SQLite amalgamation in this directory.
 *
 * Build (Windows, MinGW):
 *   gcc -O2 -shared -o gloss.dll gloss.c sqlite3.c -I.
 * Build (Linux/macOS):
 *   gcc -O2 -shared -fPIC -o libgloss.so gloss.c sqlite3.c -I.   (Linux)
 *   gcc -O2 -dynamiclib -o libgloss.dylib gloss.c sqlite3.c -I.   (macOS)
 */
#include "gloss.h"

#include <stdlib.h>
#include <string.h>

#include "sqlite3.h"

#define REL_CAP 40

struct gloss_db {
    sqlite3 *db;
};

static const char *POS_ORDER[] = {"n", "v", "a", "r"};

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

static char *xstrdup(const char *s)
{
    size_t n;
    char *p;
    if (!s)
        return NULL;
    n = strlen(s) + 1;
    p = (char *)malloc(n);
    if (p)
        memcpy(p, s, n);
    return p;
}

static const char *col_text(sqlite3_stmt *st, int col)
{
    return (const char *)sqlite3_column_text(st, col);
}

/* Parse a JSON array of strings: ["a \"quoted\" b","c"]. Returns a
 * NULL-terminated array (never NULL; empty array on parse failure).
 * Handles \" \\ \/ \b \f \n \r \t and \uXXXX (incl. surrogate pairs). */
static int hexval(char c)
{
    if (c >= '0' && c <= '9')
        return c - '0';
    if (c >= 'a' && c <= 'f')
        return c - 'a' + 10;
    if (c >= 'A' && c <= 'F')
        return c - 'A' + 10;
    return -1;
}

/* Decode one JSON string. *pp points at the opening quote on entry and past
 * the closing quote on return. Returns malloc'd UTF-8 (never NULL unless
 * malloc fails). Decoded output never exceeds the encoded length. */
static char *decode_json_string(const char **pp)
{
    const char *p = *pp;
    char *buf = (char *)malloc(strlen(p) + 1);
    char *d;
    if (!buf)
        return NULL;
    d = buf;
    p++; /* skip opening quote */
    while (*p && *p != '"') {
        if (*p == '\\' && p[1]) {
            int k, v, ok;
            unsigned cp, lo;
            p++;
            switch (*p) {
            case 'n': *d++ = '\n'; p++; break;
            case 't': *d++ = '\t'; p++; break;
            case 'r': *d++ = '\r'; p++; break;
            case 'b': *d++ = '\b'; p++; break;
            case 'f': *d++ = '\f'; p++; break;
            case '/': *d++ = '/'; p++; break;
            case '\\': *d++ = '\\'; p++; break;
            case '"': *d++ = '"'; p++; break;
            case 'u':
                cp = 0;
                ok = 1;
                for (k = 1; k <= 4; k++) {
                    v = hexval(p[k]);
                    if (v < 0)
                        ok = 0;
                    else
                        cp = (cp << 4) | (unsigned)v;
                }
                p += 5;
                if (ok && cp >= 0xD800 && cp <= 0xDBFF &&
                    p[0] == '\\' && p[1] == 'u') {
                    lo = 0;
                    ok = 1;
                    for (k = 2; k <= 5; k++) {
                        v = hexval(p[k]);
                        if (v < 0)
                            ok = 0;
                        else
                            lo = (lo << 4) | (unsigned)v;
                    }
                    if (ok && lo >= 0xDC00 && lo <= 0xDFFF) {
                        cp = 0x10000u + ((cp - 0xD800u) << 10) + (lo - 0xDC00u);
                        p += 6;
                    }
                }
                if (!ok || (cp >= 0xD800 && cp <= 0xDFFF))
                    cp = 0xFFFDu; /* replacement character */
                if (cp < 0x80) {
                    *d++ = (char)cp;
                } else if (cp < 0x800) {
                    *d++ = (char)(0xC0 | (cp >> 6));
                    *d++ = (char)(0x80 | (cp & 0x3F));
                } else if (cp < 0x10000) {
                    *d++ = (char)(0xE0 | (cp >> 12));
                    *d++ = (char)(0x80 | ((cp >> 6) & 0x3F));
                    *d++ = (char)(0x80 | (cp & 0x3F));
                } else {
                    *d++ = (char)(0xF0 | (cp >> 18));
                    *d++ = (char)(0x80 | ((cp >> 12) & 0x3F));
                    *d++ = (char)(0x80 | ((cp >> 6) & 0x3F));
                    *d++ = (char)(0x80 | (cp & 0x3F));
                }
                break;
            default: *d++ = *p++; break;
            }
        } else {
            *d++ = *p++;
        }
    }
    *d = '\0';
    if (*p == '"')
        p++;
    *pp = p;
    return buf;
}

static char **parse_json_strarr(const char *json)
{
    char **out = NULL;
    size_t n = 0, cap = 0;
    const char *p;
    if (!json || *json != '[') {
        out = (char **)malloc(sizeof(char *));
        if (out)
            out[0] = NULL;
        return out;
    }
    p = json + 1;
    for (;;) {
        char *s;
        while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r' || *p == ',')
            p++;
        if (*p == ']') {
            p++;
            break;
        }
        if (*p != '"')
            break; /* malformed: stop, keep what we have */
        s = decode_json_string(&p);
        if (!s)
            break; /* malloc failure */
        if (n + 2 > cap) {
            cap = cap ? cap * 2 : 8;
            out = (char **)realloc(out, cap * sizeof(char *));
            if (!out) {
                free(s);
                break;
            }
        }
        out[n++] = s;
    }
    if (!out) {
        out = (char **)malloc(sizeof(char *));
        n = 0;
    }
    if (out)
        out[n] = NULL;
    return out;
}

static void free_strarr(char **arr)
{
    char **p;
    if (!arr)
        return;
    for (p = arr; *p; p++)
        free(*p);
    free(arr);
}

/* ASCII lowercase copy; NULL if nothing changed. */
static char *ascii_lower(const char *s)
{
    char *out = xstrdup(s);
    char *p;
    int changed = 0;
    if (!out)
        return NULL;
    for (p = out; *p; p++) {
        if (*p >= 'A' && *p <= 'Z') {
            *p = (char)(*p + 32);
            changed = 1;
        }
    }
    if (!changed) {
        free(out);
        return NULL;
    }
    return out;
}

static int ascii_casecmp(const char *a, const char *b)
{
    for (;; a++, b++) {
        unsigned char ca = (unsigned char)*a;
        unsigned char cb = (unsigned char)*b;
        if (ca >= 'A' && ca <= 'Z')
            ca += 32;
        if (cb >= 'A' && cb <= 'Z')
            cb += 32;
        if (ca != cb || ca == '\0')
            return (int)ca - (int)cb;
    }
}

/* Words of one synset, in synset word order (data-file surface forms). */
static char **synset_words(sqlite3 *db, long offset, const char *pos)
{
    static const char *sql =
        "SELECT word FROM synset_word "
        "WHERE synset_offset = ?1 AND pos = ?2 ORDER BY word_pos";
    sqlite3_stmt *st;
    char **out = NULL;
    size_t n = 0, cap = 0;
    if (sqlite3_prepare_v2(db, sql, -1, &st, NULL) != SQLITE_OK)
        return NULL;
    sqlite3_bind_int64(st, 1, offset);
    sqlite3_bind_text(st, 2, pos, -1, SQLITE_STATIC);
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (n + 2 > cap) {
            cap = cap ? cap * 2 : 8;
            out = (char **)realloc(out, cap * sizeof(char *));
            if (!out)
                break;
        }
        out[n++] = xstrdup(col_text(st, 0));
    }
    sqlite3_finalize(st);
    if (!out) {
        out = (char **)malloc(sizeof(char *));
        n = 0;
    }
    if (out)
        out[n] = NULL;
    return out;
}

/* ------------------------------------------------------------------ */
/* open / close                                                        */
/* ------------------------------------------------------------------ */

gloss_db_t *gloss_open(const char *path)
{
    gloss_db_t *g;
    if (!path)
        return NULL;
    g = (gloss_db_t *)calloc(1, sizeof(*g));
    if (!g)
        return NULL;
    if (sqlite3_open_v2(path, &g->db, SQLITE_OPEN_READONLY, NULL) != SQLITE_OK) {
        free(g);
        return NULL;
    }
    return g;
}

void gloss_close(gloss_db_t *db)
{
    if (!db)
        return;
    sqlite3_close(db->db);
    free(db);
}

/* ------------------------------------------------------------------ */
/* define                                                              */
/* ------------------------------------------------------------------ */

char *gloss_define(gloss_db_t *db, const char *word)
{
    static const char *sql =
        "SELECT s.definition FROM sense s JOIN lemma l ON l.id = s.lemma_id "
        "WHERE l.lemma = ?1 AND l.pos = ?2 AND s.sense_no = 1";
    sqlite3_stmt *st;
    char *result = NULL;
    char *lower;
    int f, nf;
    size_t i;
    if (!db || !word)
        return NULL;
    if (sqlite3_prepare_v2(db->db, sql, -1, &st, NULL) != SQLITE_OK)
        return NULL;
    /* Data files keep original case ("French leave"); index entries are
     * lowercase. Try the word as given, then lowercased. */
    lower = ascii_lower(word);
    nf = lower ? 2 : 1;
    for (f = 0; f < nf && !result; f++) {
        const char *form = f ? lower : word;
        for (i = 0; i < sizeof(POS_ORDER) / sizeof(POS_ORDER[0]); i++) {
            sqlite3_bind_text(st, 1, form, -1, SQLITE_STATIC);
            sqlite3_bind_text(st, 2, POS_ORDER[i], -1, SQLITE_STATIC);
            if (sqlite3_step(st) == SQLITE_ROW) {
                result = xstrdup(col_text(st, 0));
                break;
            }
            sqlite3_reset(st);
            sqlite3_clear_bindings(st);
        }
        sqlite3_reset(st);
        sqlite3_clear_bindings(st);
    }
    sqlite3_finalize(st);
    free(lower);
    return result;
}

void gloss_free_str(char *s)
{
    free(s);
}

/* ------------------------------------------------------------------ */
/* lookup                                                              */
/* ------------------------------------------------------------------ */

gloss_entry_t *gloss_lookup(gloss_db_t *db, const char *word)
{
    static const char *sql =
        "SELECT l.pos, s.sense_no, s.synset_offset, s.pos, s.definition, s.examples "
        "FROM sense s JOIN lemma l ON l.id = s.lemma_id "
        "WHERE l.lemma = ?1 "
        "ORDER BY CASE l.pos WHEN 'n' THEN 0 WHEN 'v' THEN 1 "
        "WHEN 'a' THEN 2 ELSE 3 END, s.sense_no";
    sqlite3_stmt *st;
    gloss_entry_t *e;
    char *lower;
    int f, nf;
    size_t n = 0, cap = 0;
    if (!db || !word)
        return NULL;
    e = (gloss_entry_t *)calloc(1, sizeof(*e));
    if (!e)
        return NULL;
    e->word = xstrdup(word);
    if (sqlite3_prepare_v2(db->db, sql, -1, &st, NULL) != SQLITE_OK) {
        free(e->word);
        free(e);
        return NULL;
    }
    lower = ascii_lower(word);
    nf = lower ? 2 : 1;
    for (f = 0; f < nf; f++) {
        const char *form = f ? lower : word;
        sqlite3_bind_text(st, 1, form, -1, SQLITE_STATIC);
        while (sqlite3_step(st) == SQLITE_ROW) {
        gloss_sense_t *sn;
        char **words, **syn = NULL;
        size_t m = 0, scap = 0, k;
        if (n == cap) {
            cap = cap ? cap * 2 : 8;
            e->senses = (gloss_sense_t *)realloc(e->senses, cap * sizeof(gloss_sense_t));
            if (!e->senses) {
                n = 0;
                break;
            }
        }
        sn = &e->senses[n];
        memset(sn, 0, sizeof(*sn));
        sn->pos = xstrdup(col_text(st, 0));
        sn->sense_no = sqlite3_column_int(st, 1);
        sn->synset_offset = sqlite3_column_int64(st, 2);
        sn->synset_pos = xstrdup(col_text(st, 3));
        sn->definition = xstrdup(col_text(st, 4));
        sn->examples = parse_json_strarr(col_text(st, 5));
        words = synset_words(db->db, sn->synset_offset, sn->synset_pos);
        if (words) {
            for (k = 0; words[k]; k++) {
                if (ascii_casecmp(words[k], word) == 0)
                    continue;
                if (m + 2 > scap) {
                    scap = scap ? scap * 2 : 8;
                    syn = (char **)realloc(syn, scap * sizeof(char *));
                    if (!syn)
                        break;
                }
                syn[m++] = xstrdup(words[k]);
            }
            free_strarr(words);
        }
        if (!syn) {
            syn = (char **)malloc(sizeof(char *));
            m = 0;
        }
        if (syn)
            syn[m] = NULL;
        sn->synonyms = syn;
        n++;
    }
    sqlite3_reset(st);
    sqlite3_clear_bindings(st);
    if (n > 0)
        break; /* don't merge exact-form and lowercase hits */
    }
    sqlite3_finalize(st);
    free(lower);
    e->nsenses = (int)n;
    if (n == 0) {
        gloss_free_entry(e);
        return NULL;
    }
    return e;
}

void gloss_free_entry(gloss_entry_t *e)
{
    int i;
    if (!e)
        return;
    free(e->word);
    for (i = 0; i < e->nsenses; i++) {
        gloss_sense_t *sn = &e->senses[i];
        free(sn->pos);
        free(sn->synset_pos);
        free(sn->definition);
        free_strarr(sn->examples);
        free_strarr(sn->synonyms);
    }
    free(e->senses);
    free(e);
}

/* ------------------------------------------------------------------ */
/* relations                                                           */
/* ------------------------------------------------------------------ */

int gloss_related(gloss_db_t *db, const gloss_sense_t *sense,
                  const char *rel, gloss_related_t **out)
{
    static const char *sql =
        "SELECT r.to_offset, r.to_pos FROM relation r "
        "WHERE r.from_offset = ?1 AND r.from_pos = ?2 AND r.ptr = ?3 "
        "ORDER BY r.to_offset LIMIT 40";
    static const char *defsql =
        "SELECT definition FROM synset WHERE offset = ?1 AND pos = ?2";
    sqlite3_stmt *st, *dst;
    gloss_related_t *rels = NULL;
    int n = 0;
    *out = NULL;
    if (!db || !sense || !rel)
        return 0;
    if (sqlite3_prepare_v2(db->db, sql, -1, &st, NULL) != SQLITE_OK)
        return 0;
    if (sqlite3_prepare_v2(db->db, defsql, -1, &dst, NULL) != SQLITE_OK) {
        sqlite3_finalize(st);
        return 0;
    }
    sqlite3_bind_int64(st, 1, sense->synset_offset);
    sqlite3_bind_text(st, 2, sense->synset_pos, -1, SQLITE_STATIC);
    sqlite3_bind_text(st, 3, rel, -1, SQLITE_STATIC);
    while (sqlite3_step(st) == SQLITE_ROW) {
        long to_off = sqlite3_column_int64(st, 0);
        const char *to_pos = col_text(st, 1);
        gloss_related_t *r;
        rels = (gloss_related_t *)realloc(rels, (n + 1) * sizeof(gloss_related_t));
        if (!rels) {
            n = 0;
            break;
        }
        r = &rels[n];
        memset(r, 0, sizeof(*r));
        r->words = synset_words(db->db, to_off, to_pos);
        sqlite3_bind_int64(dst, 1, to_off);
        sqlite3_bind_text(dst, 2, to_pos, -1, SQLITE_STATIC);
        if (sqlite3_step(dst) == SQLITE_ROW)
            r->definition = xstrdup(col_text(dst, 0));
        else
            r->definition = xstrdup("");
        sqlite3_reset(dst);
        sqlite3_clear_bindings(dst);
        n++;
    }
    sqlite3_finalize(st);
    sqlite3_finalize(dst);
    *out = rels;
    return n;
}

void gloss_free_related(gloss_related_t *rels, int n)
{
    int i;
    if (!rels)
        return;
    for (i = 0; i < n; i++) {
        free_strarr(rels[i].words);
        free(rels[i].definition);
    }
    free(rels);
}

/* ------------------------------------------------------------------ */
/* search                                                              */
/* ------------------------------------------------------------------ */

const char **gloss_search(gloss_db_t *db, const char *prefix, int limit)
{
    /* LIKE with ESCAPE so %, _ and \ in the prefix are literal. */
    static const char *sql =
        "SELECT DISTINCT lemma FROM lemma "
        "WHERE lemma LIKE ?1 ESCAPE '\\' ORDER BY lemma LIMIT ?2";
    sqlite3_stmt *st;
    const char **out = NULL;
    char *pat = NULL;
    size_t n = 0, cap = 0, i, plen;
    if (!db || !prefix || limit <= 0)
        return NULL;
    plen = strlen(prefix);
    pat = (char *)malloc(plen * 2 + 2);
    if (!pat)
        return NULL;
    for (i = 0; i < plen; i++) {
        char c = prefix[i];
        if (c == '%' || c == '_' || c == '\\')
            pat[n++] = '\\'; /* note: n reused as write index here */
        pat[n++] = c;
    }
    pat[n++] = '%';
    pat[n] = '\0';
    if (sqlite3_prepare_v2(db->db, sql, -1, &st, NULL) != SQLITE_OK) {
        free(pat);
        return NULL;
    }
    sqlite3_bind_text(st, 1, pat, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(st, 2, limit);
    free(pat);
    n = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (n + 2 > cap) {
            cap = cap ? cap * 2 : 16;
            out = (const char **)realloc(out, cap * sizeof(char *));
            if (!out)
                break;
        }
        out[n++] = xstrdup(col_text(st, 0));
    }
    sqlite3_finalize(st);
    if (!out) {
        out = (const char **)malloc(sizeof(char *));
        n = 0;
    }
    if (out)
        out[n] = NULL;
    return out;
}

void gloss_free_strarr(const char **arr)
{
    const char **p;
    if (!arr)
        return;
    for (p = arr; *p; p++)
        free((void *)*p);
    free((void *)arr);
}
