'use strict';

const db = require('./db');

// Return the category for the first enabled rule that matches, else null.
// match_field is 'vendor' or 'filename'; pattern is a case-insensitive substring.
function categoryFor({ vendor, original_filename }) {
  const rules = db
    .prepare('SELECT match_field, pattern, category FROM rules WHERE enabled = 1')
    .all();
  for (const rule of rules) {
    const haystack =
      rule.match_field === 'filename' ? original_filename : vendor;
    if (
      haystack &&
      String(haystack).toLowerCase().includes(String(rule.pattern).toLowerCase())
    ) {
      return rule.category;
    }
  }
  return null;
}

module.exports = { categoryFor };
