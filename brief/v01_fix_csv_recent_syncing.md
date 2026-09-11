# 📋 Brief Perbaikan: CSV Recent Not Syncing & Keep Clearing

### 🔴 1. Masalah Utama (Root Cause)
- **Terhapus Otomatis (Auto-Clearing)**: Fungsi `isArtifactFile()` pada `splitViewManager.ts` sebelumnya mengkategorikan seluruh file di dalam folder `artifacts/` (termasuk `recents.csv` dan tabel artefak) sebagai *"file terlarang/internal"*.
- **Siklus Pembersihan Destruktif**: Setiap kali event `file-open`, `refreshRecentFiles()`, `loadRecentsFromCsvArtifact()`, atau `saveRecentsCsvArtifact()` berjalan, sistem secara otomatis menghapus entri artefak tersebut dari daftar recent dan menulis ulang file `recents.csv`.
- **Akibat**: Seluruh riwayat file di folder `artifacts/` terus terhapus/hilang secara tiba-tiba dan tidak tersimpan dengan stabil antarsesi.

---

### 🟢 2. Solusi & Perbaikan yang Diterapkan

1. **Perbaikan Jalur Proteksi (`isArtifactFile`)**:
   - Memperbarui logika di [splitViewManager.ts](file:///d:/0pro/pakcli-plugin/panel/src/features/explorer/splitViewManager.ts) agar file valid di dalam `artifacts/` **tidak lagi dianggap sebagai file yang harus dibuang**.

2. **Validasi Ketersediaan File Real-Time (Vault Availability Check)**:
   - File hanya akan dihapus dari daftar recent **jika file tersebut memang sudah dihapus fisik dari vault** (`!(app.vault.getAbstractFileByPath(path) instanceof TFile)`).

3. **Penyinkronan & Auto-Discovery Artefak**:
   - `initRecentFiles()` dan `loadRecentsFromCsvArtifact()` kini melakukan pemindaian otomatis terhadap file artefak yang tersedia di vault pada saat plugin dimuat.
   - Menghapus pembersihan otomatis destruktif sehingga data histori tersimpan permanen di `recents.csv`.

---

### 🚀 3. Hasil Setelah Perbaikan
- ✅ **Tidak Terhapus Lagi**: File di dalam `artifacts/` tetap tersimpan stabil di daftar Recent Splitview.
- ✅ **Sinkronisasi Otomatis**: Perubahan riwayat file langsung tersimpan ke `recents.csv` tanpa membuang entri terdahulu.
- ✅ **Tersimpan Antarsesi**: Mengunci dan mempertahankan histori recent saat Obsidian dibuka kembali.
