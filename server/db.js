import mysql from "mysql2/promise";
import { config } from "./config.js";

export const pool = mysql.createPool({ ...config.db, connectionLimit: 8, charset: "utf8mb4" });
export const q = async (sql, params = []) => (await pool.query(sql, params))[0];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS folders (
     id INT AUTO_INCREMENT PRIMARY KEY,
     kind ENUM('history','programs') NOT NULL,
     name VARCHAR(120) NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     KEY (kind, name)
   ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS items (
     id INT AUTO_INCREMENT PRIMARY KEY,
     folder_id INT NOT NULL,
     title VARCHAR(200) NOT NULL,
     body MEDIUMTEXT NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     KEY (folder_id, title),
     CONSTRAINT fk_item_folder FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
   ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS runs (
     id INT AUTO_INCREMENT PRIMARY KEY,
     ref_osis VARCHAR(80) NOT NULL,
     ref_en VARCHAR(120) NOT NULL,
     requester ENUM('owner','visitor') NOT NULL,
     ip_hash CHAR(64) NOT NULL,
     cached TINYINT NOT NULL DEFAULT 0,
     status ENUM('ok','error') NOT NULL,
     result MEDIUMTEXT NULL,
     steps MEDIUMTEXT NULL,
     cost_usd DECIMAL(10,5) NULL,
     duration_ms INT NOT NULL DEFAULT 0,
     error VARCHAR(500) NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     KEY (ref_osis, status), KEY (ip_hash, created_at), KEY (created_at)
   ) CHARACTER SET utf8mb4`,
];

export async function migrate() {
  for (const sql of SCHEMA) await q(sql);
  const [{ n }] = await q("SELECT COUNT(*) AS n FROM folders");
  if (n === 0) {
    for (const name of ["Funerals", "General", "Normal Sundays", "Passover"])
      await q("INSERT INTO folders (kind, name) VALUES ('history', ?)", [name]);
    await q("INSERT INTO folders (kind, name) VALUES ('programs', 'Church Programs')");
  }
}
