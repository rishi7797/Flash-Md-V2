import yts from 'yt-search';
import axios from 'axios';
import { API_CONFIG } from '../france/index.js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { t, translate, translateAIResponse, getUserLang } from '../france/translator.js';

let ffmpegPath = null;

if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
  ffmpegPath = ffmpegStatic;
  try {
    execSync(`${ffmpegPath} -version`);
  } catch {
    ffmpegPath = null;
  }
}

if (!ffmpegPath) {
  try {
    execSync('ffmpeg -version');
    ffmpegPath = 'ffmpeg';
  } catch {
    try {
      execSync('/usr/bin/ffmpeg -version');
      ffmpegPath = '/usr/bin/ffmpeg';
    } catch {
      try {
        execSync('/usr/local/bin/ffmpeg -version');
        ffmpegPath = '/usr/local/bin/ffmpeg';
      } catch {
        ffmpegPath = null;
      }
    }
  }
}

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

export const commands = [
  {
    name: 'play',
    description: 'Search and download MP3 audio from YouTube (audio only).',
    category: 'Search',
    execute: async ({ sock, from, text, msg, config }) => {
      const botName = config.BOT_NAME || 'Flash-MD';
      const botVersion = config.BOT_VERSION || '3.0.0';

      if (!text) {
        const noQueryMsg = await t(from, 'play', 'noQuery');
        return sock.sendMessage(from, { text: `${noQueryMsg}\n\n⚡ Powered by ${botName} ${botVersion}` });
      }

      try {
        if (!API_CONFIG?.nayanApi?.youtube) {
          throw new Error('Nayan API not configured');
        }

        const searchingMsg = await t(from, 'play', 'searching');
        await sock.sendMessage(from, { text: searchingMsg }, { quoted: msg });

        const search = await yts(text);
        const video = search.videos?.[0];

        if (!video) {
          const notFoundMsg = await t(from, 'play', 'notFound');
          return sock.sendMessage(from, { text: `${notFoundMsg}\n\n⚡ Powered by ${botName} ${botVersion}` });
        }

        const videoUrl = `https://youtu.be/${video.videoId}`;
        const apiUrl = `${API_CONFIG.nayanApi.youtube}?url=${encodeURIComponent(videoUrl)}`;

        const downloadingMsg = await t(from, 'play', 'downloading');
        await sock.sendMessage(from, { text: downloadingMsg }, { quoted: msg });

        const response = await axios.get(apiUrl, {
          timeout: API_CONFIG.nayanApi.timeout || 30000
        });

        if (!response.data?.status || !response.data?.data?.audio) {
          const failedMsg = await t(from, 'play', 'failed');
          return sock.sendMessage(from, { text: `${failedMsg}\n\n⚡ Powered by ${botName} ${botVersion}` });
        }

        const downloadLink = response.data.data.audio;
        const videoInfo = response.data.data;

        const safeTitle = (video.title || 'audio').replace(/[\\/:*?"<>|]/g, '');
        const fileName = `${safeTitle}.mp3`;

        const titleLabel = await t(from, 'play', 'title');
        const durationLabel = await t(from, 'play', 'duration');
        const viewsLabel = await t(from, 'play', 'views');
        const uploadedLabel = await t(from, 'play', 'uploaded');
        const channelLabel = await t(from, 'play', 'channel');
        const qualityLabel = await t(from, 'play', 'quality');
        const poweredLabel = await t(from, 'play', 'powered');

        await sock.sendMessage(from, {
          image: { url: video.thumbnail || videoInfo.thumb || 'https://via.placeholder.com/300' },
          caption:
            `*🎵 ${botName.toUpperCase()} SONG PLAYER*\n\n` +
            `╭─❏ ${titleLabel} ${videoInfo.title || video.title}\n` +
            `│ ${durationLabel} ${video.timestamp || 'N/A'}\n` +
            `│ ${viewsLabel} ${video.views?.toLocaleString() || 'N/A'}\n` +
            `│ ${uploadedLabel} ${video.ago || 'N/A'}\n` +
            `│ ${channelLabel} ${videoInfo.channel || video.author?.name}\n` +
            `│ ${qualityLabel} ${videoInfo.quality || '128'}kbps\n` +
            `│ ${poweredLabel} ${botName}\n` +
            `╰─────────────\n\n` +
            `🔗 https://youtube.com/watch?v=${video.videoId}`
        }, { quoted: msg });

        const tempDir = process.env.TEMP_DIR || './temp';
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const audioRes = await axios.get(downloadLink, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (!ffmpegPath) {
          const sendingMsg = await t(from, 'play', 'sending');
          await sock.sendMessage(from, { text: sendingMsg }, { quoted: msg });
          await sock.sendMessage(from, {
            audio: audioRes.data,
            mimetype: 'audio/mpeg',
            fileName
          }, { quoted: msg });
          return;
        }

        const inputPath = path.join(tempDir, `${Date.now()}.m4a`);
        const outputPath = path.join(tempDir, `${Date.now()}.mp3`);

        fs.writeFileSync(inputPath, audioRes.data);

        const processingMsg = await t(from, 'play', 'processing');
        await sock.sendMessage(from, { text: processingMsg }, { quoted: msg });

        const conversionPromise = new Promise((resolve, reject) => {
          ffmpeg(inputPath)
            .audioBitrate(128)
            .audioCodec('libmp3lame')
            .toFormat('mp3')
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .save(outputPath);
        });

        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('FFmpeg timeout')), 30000)
        );

        try {
          await Promise.race([conversionPromise, timeoutPromise]);
          
          const sendingMsg = await t(from, 'play', 'sending');
          await sock.sendMessage(from, { text: sendingMsg }, { quoted: msg });
          
          await sock.sendMessage(from, {
            audio: fs.readFileSync(outputPath),
            mimetype: 'audio/mpeg',
            fileName
          }, { quoted: msg });
          
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch (conversionError) {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          
          const sendingOriginalMsg = await t(from, 'play', 'sendingOriginal');
          await sock.sendMessage(from, { text: sendingOriginalMsg }, { quoted: msg });
          await sock.sendMessage(from, {
            audio: audioRes.data,
            mimetype: 'audio/mpeg',
            fileName
          }, { quoted: msg });
        }

      } catch (err) {
        console.error('Play command error:', err.message);
        if (err.response) {
          console.error('Response data:', err.response.data);
        }
        const errorMsg = await t(from, 'play', 'error');
        sock.sendMessage(from, { text: `${errorMsg} ${err.message || 'Unknown error'}\n\n⚡ Powered by ${botName} ${botVersion}` });
      }
    }
  }
];
