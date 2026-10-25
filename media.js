import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import { db, MEDIA_DIR } from './db.js';
import { randomToken } from './crypto.js';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) =>
    /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)
      ? cb(null, true)
      : cb(new Error('סוג קובץ לא נתמך - העלו JPG / PNG / WEBP')),
});

// אינסטגרם מקבל JPEG ביחס גובה-רוחב בין 4:5 (0.8) ל-1.91:1.
// חותכים למרכז אם התמונה חורגת, ומקטינים לרוחב 1440 לכל היותר.
const MIN_RATIO = 0.8;
const MAX_RATIO = 1.91;

// סטורי: 1080x1920 (9:16). התמונה נכנסת במלואה, והרקע ממולא בגרסה מטושטשת שלה
// כך שלא נחתך שום חלק חשוב מהתמונה.
const STORY_W = 1080;
const STORY_H = 1920;

async function toStory(rotated) {
  const bg = await sharp(rotated)
    .resize(STORY_W, STORY_H, { fit: 'cover' })
    .blur(40)
    .modulate({ brightness: 0.8 })
    .toBuffer();
  const fg = await sharp(rotated)
    .resize(STORY_W, STORY_H, { fit: 'inside' })
    .toBuffer();
  return sharp(bg).composite([{ input: fg, gravity: 'center' }]);
}

export async function processAndSave(buffer, userId, { source = 'upload', prompt = null, format = 'feed' } = {}) {
  // מיישרים לפי EXIF קודם, כדי שהממדים יהיו נכונים
  const { data: rotated, info } = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .toBuffer({ resolveWithObject: true });

  if (format === 'story') {
    const img = await toStory(rotated);
    const out = await img.flatten({ background: '#000000' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    return save(out, userId, { source, prompt, format });
  }

  const { width, height } = info;
  let img = sharp(rotated);

  const ratio = width / height;
  if (ratio < MIN_RATIO) {
    const h = Math.round(width / MIN_RATIO);
    img = img.extract({ left: 0, top: Math.round((height - h) / 2), width, height: h });
  } else if (ratio > MAX_RATIO) {
    const w = Math.round(height * MAX_RATIO);
    img = img.extract({ left: Math.round((width - w) / 2), top: 0, width: w, height });
  }

  const out = await img
    .resize({ width: 1440, withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  return save(out, userId, { source, prompt, format: 'feed' });
}

async function save(out, userId, { source, prompt, format }) {
  // שם קובץ אקראי ולא ניתן לניחוש (התמונה חייבת להיות ציבורית עבור אינסטגרם)
  const filename = `${randomToken(16)}.jpg`;
  await fs.writeFile(path.join(MEDIA_DIR, filename), out);

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO media (user_id, filename, source, prompt, format, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, filename, source, prompt, format, Date.now());

  return { id: Number(lastInsertRowid), filename, format, url: mediaUrl(filename) };
}

export const mediaUrl = (filename) => `/media/${filename}`;
export const publicMediaUrl = (filename) => `${process.env.PUBLIC_BASE_URL}/media/${filename}`;
