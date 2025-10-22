// Ini adalah file Vercel Serverless Function
// Simpan sebagai: /api/get-questions.js

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
    
    // Catatan: Di aplikasi production, kamu harus cek header otentikasi
    // (misalnya, cek apakah 'uniqueCode' yang disimpan di localStorage valid)
    // Tapi untuk proyek ini, kita anggap jika frontend memanggil, itu valid.

    try {
        // Ambil semua data dari 'List' DaftarSoal
        // lrange(key, 0, -1) artinya "ambil semua elemen dari list"
        const questionStrings = await kv.lrange('DaftarSoal', 0, -1);

        if (!questionStrings || questionStrings.length === 0) {
            return res.status(200).json({ questions: [] });
        }
        
        // Data disimpan sebagai string JSON, jadi kita perlu parse
        const questions = questionStrings.map(q => JSON.parse(q));

        // Format data untuk frontend (hanya kirim yang perlu)
        const formattedQuestions = questions.map(q => ({
            ruang: q.ruang,
            soal: q.soal, // Ini adalah soal yang sudah di-refine
            jawaban: q.jawaban // Ini adalah jawaban yang sudah di-refine
        })).filter(q => q.soal && q.jawaban); // Pastikan data valid

        // Kirim data sebagai JSON
        res.status(200).json({ questions: formattedQuestions });

    } catch (error) {
        console.error('Get questions error:', error);
        res.status(500).json({ error: 'Gagal mengambil data soal dari server.' });
    }
}

