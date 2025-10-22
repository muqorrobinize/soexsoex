// Ini adalah file Vercel Serverless Function
// Simpan sebagai: /api/get-questions.js
// PERUBAHAN: Mengambil data dari HASH 'soexsoex:questions', bukan LIST 'DaftarSoal'

import { createClient } from '@vercel/kv';

// Inisialisasi Vercel KV
// Variabel ini otomatis didapat dari Vercel saat kamu menghubungkan KV
const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
    
    // ... (Logika otentikasi bisa ditambahkan di sini) ...

    try {
        // PERUBAHAN BESAR:
        // Kita tidak lagi pakai lrange, tapi hgetall untuk mengambil semua field dari Hash
        const questionDataHash = await kv.hgetall('soexsoex:questions');

        if (!questionDataHash) {
            return res.status(200).json({ questions: [] });
        }
        
        // hgetall mengembalikan objek: { "uuid-1": "{data1}", "uuid-2": "{data2}" }
        // Kita hanya butuh valuenya (datanya)
        const questionStrings = Object.values(questionDataHash);

        if (questionStrings.length === 0) {
            return res.status(200).json({ questions: [] });
        }
        
        // Data disimpan sebagai string JSON, jadi kita perlu parse
        const questions = questionStrings.map(q => JSON.parse(q));

        // Format data untuk frontend (hanya kirim yang perlu)
        // Logika ini TIDAK PERLU BERUBAH, karena kita masih mengirim
        // 'soal' (master soal) dan 'jawaban' (master jawaban yang sudah di-enrich)
        const formattedQuestions = questions.map(q => ({
            ruang: q.ruang,
            soal: q.soal, // Ini adalah soal master (hasil refine)
            jawaban: q.jawaban // Ini adalah jawaban master (hasil enrich)
        })).filter(q => q.soal && q.jawaban); // Pastikan data valid

        // Kirim data sebagai JSON
        res.status(200).json({ questions: formattedQuestions });

    } catch (error) {
        console.error('Get questions error:', error);
        res.status(500).json({ error: 'Gagal mengambil data soal dari server.' });
    }
}

