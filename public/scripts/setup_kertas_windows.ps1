# Daftarkan ukuran kertas "SLM Continuous 12x14" (120 x 140 mm) ke Windows lewat API winspool AddForm.
# Dijalankan oleh setup_kertas_windows.bat (Run as administrator).
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class SlmForms {
  [StructLayout(LayoutKind.Sequential)] public struct SIZEL { public int cx; public int cy; }
  [StructLayout(LayoutKind.Sequential)] public struct RECTL { public int left; public int top; public int right; public int bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct FORM_INFO_1 { public int Flags; public string pName; public SIZEL Size; public RECTL ImageableArea; }
  [StructLayout(LayoutKind.Sequential)] public struct PRINTER_DEFAULTS { public IntPtr pDatatype; public IntPtr pDevMode; public int DesiredAccess; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string name, out IntPtr h, ref PRINTER_DEFAULTS d);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool AddForm(IntPtr h, int level, ref FORM_INFO_1 f);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetForm(IntPtr h, string name, int level, ref FORM_INFO_1 f);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  // Ukuran dalam seperseribu milimeter.
  public static string Register(string name, int w, int h) {
    var d = new PRINTER_DEFAULTS(); d.DesiredAccess = 1; // SERVER_ACCESS_ADMINISTER
    IntPtr hp;
    if (!OpenPrinter(null, out hp, ref d)) return "Gagal membuka print server (kode " + Marshal.GetLastWin32Error() + ")";
    try {
      var f = new FORM_INFO_1(); f.pName = name; f.Size.cx = w; f.Size.cy = h; f.ImageableArea.right = w; f.ImageableArea.bottom = h;
      if (AddForm(hp, 1, ref f)) return "OK";
      int e = Marshal.GetLastWin32Error();
      if (e == 80 || e == 183) return SetForm(hp, name, 1, ref f) ? "OK" : "Gagal memperbarui ukuran (kode " + Marshal.GetLastWin32Error() + ")";
      return "Gagal mendaftarkan ukuran (kode " + e + ")";
    } finally { ClosePrinter(hp); }
  }
}
"@
$result = [SlmForms]::Register('SLM Continuous 12x14', 120000, 140000)
if ($result -eq 'OK') {
  Write-Host '[SUKSES] Ukuran kertas "SLM Continuous 12x14" (12 x 14 cm) terdaftar di Windows.' -ForegroundColor Green
  exit 0
}
Write-Host "[GAGAL] $result" -ForegroundColor Red
Write-Host 'Daftarkan manual: tekan Windows+R, ketik  printui /s /t2  lalu Enter. Centang "Create a new form", nama SLM Continuous 12x14, Width 12.00cm, Height 14.00cm, margin 0, lalu Save Form.'
exit 1
