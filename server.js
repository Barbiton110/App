import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEDIA_DIR } from './db.js';
import { authRouter, loadUser } from './auth.js';
import { api, igAuth } from './routes.js';
import { startScheduler } from './scheduler.js';
import { html } from './page.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(loadUser);

// התמונות חייבות להיות נגישות לציבור כדי שאינסטגרם יוכל להוריד אותן
app.use('/media', express.static(MEDIA_DIR, { maxAge: '7d', index: false }));
// הקבצים של הממשק נמצאים באותה תיקייה כמו השרת - מגישים רק אותם (לא את כל התיקייה)
const page = (file, type) => (_req, res) => res.type(type).sendFile(path.join(__dirname, file));
app.get('/', (_req, res) => res.type('html').send(html));
app.get('/app.js', page('app.js', 'js'));
app.get('/style.css', page('style.css', 'css'));

app.use('/api/auth', authRouter);
app.use('/api', api);
app.use('/auth', igAuth);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`InstaPost פועל: http://localhost:${port}`);
  if (process.env.IG_DRY_RUN === '1') console.log('מצב בדיקה פעיל (IG_DRY_RUN=1) - לא יפורסם דבר באמת');
  startScheduler();
});
