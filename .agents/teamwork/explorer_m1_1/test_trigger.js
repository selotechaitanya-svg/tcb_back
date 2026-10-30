const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT, updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));
CREATE TRIGGER update_items_timestamp AFTER UPDATE ON items
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE items SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
INSERT INTO items (id, val, updated_at) VALUES (1, 'initial', '2020-01-01');
`);
console.log('Before update:', db.prepare('SELECT * FROM items').get());
db.exec("UPDATE items SET val = 'changed' WHERE id = 1;");
console.log('After update:', db.prepare('SELECT * FROM items').get());
