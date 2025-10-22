// Ini adalah file Vercel Serverless Function
// Simpan sebagai: /api/login.js

import { createClient } from '@vercel/kv';

// Inisialisasi Vercel KV
// Variabel ini otomatis didapat dari Vercel saat kamu menghubungkan KV
const kv = createClient({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { uniqueCode } = req.body;

        if (!uniqueCode) {
            return res.status(400).json({ error: 'Kode unik diperlukan.' });
        }

        const trimmedCode = uniqueCode.trim();

        // --- Kode Unik Khusus ---
        if (trimmedCode === 'truegoddess') {
            // Jika kode adalah 'truegoddess', langsung berikan akses
            return res.status(200).json({ success: true, message: 'Login berhasil, Goddess.' });
        }
        // --- Akhir Kode Unik Khusus ---


        // Cek apakah kode unik adalah anggota dari 'Set' DaftarKodeUnik
        // sismember = "is set member?" (apakah anggota set?)
        const isMember = await kv.sismember('DaftarKodeUnik', trimmedCode);

        if (isMember) {
            // Kode ditemukan dan valid
            res.status(200).json({ success: true, message: 'Login berhasil.' });
        } else {
            // Kode tidak ditemukan
            res.status(401).json({ success: false, error: 'Kode unik tidak valid.' });
        }

    } catch (error) {
        console.error('Login server error:', error);
        res.status(500).json({ success: false, error: 'Terjadi kesalahan di server.' });
    }
}

