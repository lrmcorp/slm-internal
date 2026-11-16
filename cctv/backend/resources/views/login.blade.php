@extends('layout')
@section('title', 'Masuk')
@section('content')
<div class="login-layout">
    <section class="login-form-panel">
        <a class="brand" href="/login">
            <span class="brand-mark">@include('partials.icon', ['name' => 'camera'])</span>
            <span>CCTV<span class="brand-light"> SLM</span><small>Aneka Jaya</small></span>
        </a>
        <h1>Selamat datang kembali</h1>
        <p>Masuk untuk melihat kamera dan memeriksa kejadian.</p>
        <form method="post" action="/login">
            @csrf
            <div class="form-group">
                <label for="email">Email</label>
                <input id="email" type="email" name="email" autocomplete="username" value="{{ old('email') }}" placeholder="Email akun Anda" required>
            </div>
            <div class="form-group">
                <label for="password">Kata sandi</label>
                <div class="password-field">
                    <input id="password" type="password" name="password" autocomplete="current-password" placeholder="Kata sandi Anda" required>
                    <button type="button" data-password-toggle="password" aria-pressed="false">Tampilkan</button>
                </div>
            </div>
            <button type="submit" class="w-full">
                Masuk ke dashboard @include('partials.icon', ['name' => 'arrow'])
            </button>
        </form>
        <p class="mt-6 text-xs text-muted">Akses diberikan oleh administrator CCTV SLM.</p>
    </section>
    
    <aside class="login-art">
        <span class="brand-mark">@include('partials.icon', ['name' => 'camera'])</span>
        <h2>Pantau toko.<br>Periksa dengan bukti.</h2>
        <p>Kamera, invoice, dan catatan kejadian untuk operasional Aneka Jaya.</p>
        <div class="login-foot">CCTV SLM · Aneka Jaya</div>
    </aside>
</div>
@endsection
