// Ini adalah file Vercel Serverless Function
// Simpan sebagai: /api/login.js
// PERBAIKAN: Memindahkan inisialisasi KV ke dalam try...catch
// untuk menangani error koneksi dan mengirim balasan JSON yang valid.

import { createClient } from '@vercel/kv';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // PERBAIKAN: Pindahkan inisialisasi ke dalam 'try'
        // Ini akan menangkap error jika environment variables (KV_URL, dll) tidak ada.
        const kv = createClient({
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN,
        });

        // Tambahkan pengecekan eksplisit
        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
            throw new Error("Variabel Vercel KV (KV_REST_API_URL, KV_REST_API_TOKEN) belum di-set di Vercel.");
        }

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
        console.error('Login server error:', error.message);
        // SEKARANG, jika KV gagal, error akan ditangkap di sini dan dikirim sebagai JSON
        res.status(500).json({ 
            success: false, 
            error: 'Terjadi kesalahan di server.',
            // Kita kirim pesan error-nya ke frontend untuk debugging
            server_message: error.message 
        });
    }
}

