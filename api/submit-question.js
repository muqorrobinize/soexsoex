// Ini adalah file Vercel Serverless Function
// Simpan sebagai: /api/submit-question.js
// PERUBAHAN BESAR: Menggunakan struktur Hash + Indeks untuk deteksi duplikat & enrichment.

import { createClient } from '@vercel/kv';
import { v4 as uuidv4 } from 'uuid';

// Inisialisasi Vercel KV
const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

// --- Logika Rotasi API Key (Autoswitch) ---
const GEMINI_API_KEY_POOL = process.env.GEMINI_API_KEY_POOL || '';
const apiKeys = GEMINI_API_KEY_POOL.split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);

if (apiKeys.length === 0) {
    console.error('CRITICAL: GEMINI_API_KEY_POOL environment variable tidak di-set atau kosong.');
}

function getNextApiKey() {
    if (apiKeys.length === 0) {
        throw new Error('Tidak ada API keys yang tersedia di pool.');
    }
    const randomIndex = Math.floor(Math.random() * apiKeys.length);
    return apiKeys[randomIndex];
}

// Helper untuk memanggil Gemini API
async function callGemini(promptText) {
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

        if (validationResult.validation !== 'VALID') {
            return res.status(400).json(validationResult);
        }

        // --- 2. AI Refinement (Perbaikan Teks) ---
        // Kita butuh hasil refine SEKARANG untuk mengecek duplikat
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
        
        const timestamp = new Date().toISOString();
        const submissionData = {
            timestamp: timestamp,
            soalAsli: soal,
            jawabanAsli: jawaban,
            jawabanRefined: refinedResult.jawaban_refined,
        };

        // --- 3. Deteksi Duplikat ---
        // Buat 'kunci' unik untuk soal. Normalisasi (lowercase, trim) penting.
        const soalIndexKey = refinedResult.soal_refined.toLowerCase().trim();
        
        // Cek ke 'indeks' apakah soal ini sudah ada
        // 'soexsoex:index:soal' adalah HASH { "teks soal": "question-id-uuid" }
        const existingQuestionId = await kv.hget('soexsoex:index:soal', soalIndexKey);

        if (existingQuestionId) {
            // --- 4a. JIKA DUPLIKAT: Enrich (Perkaya) Data ---
            
            // Ambil data lama
            const existingDataString = await kv.hget('soexsoex:questions', existingQuestionId);
            if (!existingDataString) {
                // Harusnya tidak terjadi, tapi untuk jaga-jaga (jika indeks ada tapi data tidak)
                // Kita anggap saja seperti soal baru
                await kv.hdel('soexsoex:index:soal', soalIndexKey);
                return createNewQuestion(res, ruang, refinedResult.soal_refined, soalIndexKey, submissionData, currentSubmissions);
            }
            
            const existingData = JSON.parse(existingDataString);
            
            // Tambahkan submission baru ini ke log
            existingData.submissions.push(submissionData);
            
            // --- INI PERMINTAANMU: AI ENRICHMENT ---
            const allRefinedAnswers = existingData.submissions.map(s => s.jawabanRefined);
            const enrichmentPrompt = `
                Anda adalah AI yang bertugas menggabungkan beberapa jawaban untuk satu soal menjadi satu jawaban terbaik yang paling komprehensif.
                Soal: "${existingData.soal}"
                Jawaban Master Saat Ini: "${existingData.jawaban}"
                Jawaban-jawaban Lain yang Pernah Disubmit (termasuk yang baru):
                ${allRefinedAnswers.map(a => `- ${a}`).join('\n')}
                
                Tugas Anda: Buat satu jawaban 'master' baru yang menggabungkan semua informasi terbaik dari jawaban-jawaban di atas, dan perbaiki 'Jawaban Master Saat Ini' jika perlu.
                Jawaban harus komprehensif, akurat, dan ringkas.
                
                HANYA respons dengan teks jawaban master baru tersebut.
            `;
            
            try {
                const newMasterAnswer = await callGemini(enrichmentPrompt);
                existingData.jawaban = newMasterAnswer; // Update jawaban master
            } catch (enrichErr) {
                console.error('AI enrichment failed:', enrichErr);
                // Jika gagal, setidaknya simpan jawaban refined terbaru sebagai master
                existingData.jawaban = refinedResult.jawaban_refined;
            }
            
            // Simpan kembali data yang sudah di-enrich
            // 'soexsoex:questions' adalah HASH { "question-id-uuid": "{...data...}" }
            await kv.hset('soexsoex:questions', { [existingQuestionId]: JSON.stringify(existingData) });

        } else {
            // --- 4b. JIKA BUKAN DUPLIKAT: Buat Soal Baru ---
            await createNewQuestion(res, ruang, refinedResult.soal_refined, soalIndexKey, submissionData, currentSubmissions);
        }
        
        // --- 5. Logika Kode Unik (Tetap sama) ---
        let uniqueCode = null;
        if (currentSubmissions + 1 >= 3) {
            uniqueCode = uuidv4().substring(0, 8).toUpperCase();
            await kv.sadd('DaftarKodeUnik', uniqueCode);
        }

        res.status(200).json({ 
            validation: 'VALID', 
            message: 'Soal berhasil divalidasi dan disimpan (atau diperkaya).',
            uniqueCode: uniqueCode 
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Terjadi kesalahan di server.', validation: 'INVALID' });
    }
}

// Fungsi helper untuk membuat entri soal baru
async function createNewQuestion(res, ruang, soalRefined, soalIndexKey, submissionData, currentSubmissions) {
    const questionId = uuidv4();
    
    const questionData = {
        id: questionId,
        ruang: ruang,
        soal: soalRefined, // Ini adalah 'master' soal
        jawaban: submissionData.jawabanRefined, // Jawaban pertama jadi 'master' jawaban
        submissions: [submissionData], // Log semua submission
        createdAt: submissionData.timestamp,
    };

    // Simpan ke indeks
    await kv.hset('soexsoex:index:soal', { [soalIndexKey]: questionId });
    
    // Simpan data utama
    await kv.hset('soexsoex:questions', { [questionId]: JSON.stringify(questionData) });
}

