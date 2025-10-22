// Ini adalah file Vercel Serverless Function
// Simpan sebagai: /api/submit-question.js

// PENTING: Kamu perlu menginstal '@vercel/kv' dan 'uuid'
// Jalankan: npm install @vercel/kv uuid

import { createClient } from '@vercel/kv';
import { v4 as uuidv4 } from 'uuid';

// Inisialisasi Vercel KV
// Variabel ini otomatis didapat dari Vercel saat kamu menghubungkan KV
const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

// --- Logika Rotasi API Key (Autoswitch) ---
// Ambil daftar key dari Vercel Environment Variable
const GEMINI_API_KEY_POOL = process.env.GEMINI_API_KEY_POOL || '';
// Pisahkan string menjadi array, buang spasi, dan filter jika ada yang kosong
const apiKeys = GEMINI_API_KEY_POOL.split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);

if (apiKeys.length === 0) {
    console.error('CRITICAL: GEMINI_API_KEY_POOL environment variable tidak di-set atau kosong.');
}

// Fungsi untuk mengambil satu API key secara acak dari pool
function getNextApiKey() {
    if (apiKeys.length === 0) {
        throw new Error('Tidak ada API keys yang tersedia di pool.');
    }
    // Pilih indeks acak
    const randomIndex = Math.floor(Math.random() * apiKeys.length);
    return apiKeys[randomIndex];
}

// Helper untuk memanggil Gemini API
async function callGemini(promptText) {
    // 1. Dapatkan API key acak untuk request ini
    const selectedApiKey = getNextApiKey();
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${selectedApiKey}`;
    
    try {
        const payload = {
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: {
                temperature: 0.3,
                topP: 0.9,
            }
        };

        const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Gemini API Error (key ...${selectedApiKey.slice(-4)}):`, errorBody);
            throw new Error(`Gemini API request failed with status ${response.status}`);
        }

        const result = await response.json();
        
        if (result.candidates && result.candidates.length > 0 && result.candidates[0].content?.parts?.[0]?.text) {
             return result.candidates[0].content.parts[0].text.trim();
        } else {
            console.warn('Gemini response missing expected text:', JSON.stringify(result, null, 2));
            throw new Error('Gagal memproses respons dari AI.');
        }

    } catch (error) {
        // Log error dengan 4 digit terakhir key untuk debugging
        console.error(`Error calling Gemini with key ending in ...${selectedApiKey.slice(-4)}:`, error);
        throw error;
    }
}

// Fungsi utama Serverless
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { ruang, soal, jawaban, currentSubmissions } = req.body;

        if (!ruang || !soal || !jawaban) {
            return res.status(400).json({ error: 'Ruang, soal, dan jawaban tidak boleh kosong.' });
        }

        // --- 1. AI Validation (Validasi AI) ---
        const validationPrompt = `
            Anda adalah validator bank soal olimpiade.
            Tugas Anda adalah menilai apakah jawaban yang diberikan benar atau setidaknya sangat masuk akal untuk soal yang diberikan.
            Toleransi kesalahan ketik kecil, tapi jangan terima jawaban yang jelas salah atau tidak nyambung.
            
            HANYA respons dengan format JSON berikut:
            {"validation": "VALID" | "INVALID", "reason": "alasan singkat jika INVALID"}
            
            Soal: "${soal}"
            Jawaban: "${jawaban}"
        `;
        
        let validationResult;
        try {
            const validationResponse = await callGemini(validationPrompt);
            validationResult = JSON.parse(validationResponse);
        } catch (err) {
            console.error('AI validation parse error:', err);
            return res.status(500).json({ error: 'AI Validator gagal merespons. Coba lagi.', validation: 'INVALID' });
        }

        // Jika tidak valid, stop di sini
        if (validationResult.validation !== 'VALID') {
            return res.status(400).json(validationResult);
        }

        // --- 2. AI Refinement (Perbaikan Teks) ---
        const refinePrompt = `
            Anda adalah editor teks untuk bank soal.
            Perbaiki pengetikan, ejaan, dan tata bahasa (PUEBI) dari soal dan jawaban berikut.
            Jangan mengubah makna atau substansi.
            
            HANYA respons dengan format JSON berikut:
            {"soal_refined": "teks soal yang sudah diperbaiki", "jawaban_refined": "teks jawaban yang sudah diperbaiki"}
            
            Soal Asli: "${soal}"
            Jawaban Asli: "${jawaban}"
        `;

        let refinedResult;
        try {
            const refineResponse = await callGemini(refinePrompt);
            refinedResult = JSON.parse(refineResponse);
        } catch (err) {
            console.error('AI refinement parse error:', err);
            refinedResult = { soal_refined: soal, jawaban_refined: jawaban };
        }

        // --- 3. Simpan ke Vercel KV ---
        const timestamp = new Date().toISOString();
        const questionId = uuidv4();
        
        const questionData = {
            id: questionId,
            timestamp: timestamp,
            ruang: ruang,
            soal_asli: soal,
            soal: refinedResult.soal_refined,
            jawaban_asli: jawaban,
            jawaban: refinedResult.jawaban_refined,
        };

        // Simpan soal ke dalam 'List' bernama 'DaftarSoal'
        // lpush = tambahkan ke awal list (agar data terbaru selalu di atas)
        await kv.lpush('DaftarSoal', JSON.stringify(questionData));


        // --- 4. Logika Kode Unik ---
        let uniqueCode = null;
        if (currentSubmissions + 1 >= 3) {
            uniqueCode = uuidv4().substring(0, 8).toUpperCase();
            
            // Simpan kode unik ke dalam 'Set' bernama 'DaftarKodeUnik'
            // Set otomatis menangani duplikat
            await kv.sadd('DaftarKodeUnik', uniqueCode);
        }

        // Kirim respons sukses ke frontend
        res.status(200).json({ 
            validation: 'VALID', 
            message: 'Soal berhasil divalidasi dan disimpan.',
            uniqueCode: uniqueCode 
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Terjadi kesalahan di server.', validation: 'INVALID' });
    }
}

