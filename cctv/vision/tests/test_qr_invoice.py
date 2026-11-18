import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cv2
from worker import ocr, qr_stats_snapshot_and_reset


def qr(text):
    code = cv2.QRCodeEncoder_create().encode(text)
    code = cv2.copyMakeBorder(code, 4, 4, 4, 4, cv2.BORDER_CONSTANT, value=255)
    code = cv2.resize(code, None, fx=8, fy=8, interpolation=cv2.INTER_NEAREST)
    return cv2.cvtColor(code, cv2.COLOR_GRAY2BGR)


class QrInvoiceTest(unittest.TestCase):
    @patch.dict(os.environ, {'CCTV_LABEL_MODE': 'qr', 'CCTV_AI_API_KEY': ''})
    def test_mj_invoice_qr_from_delivery_order_label(self):
        label = ocr(qr("INVOICE: MJ-20261117-0005\nCUSTOMER: ALMIRA\nASAL: MJ\nPETUGAS: ADI"))
        self.assertEqual('MJ-20261117-0005', label['field_one'])
        self.assertEqual('ALMIRA', label['field_two'])
        self.assertEqual('MJ', label['field_three'])

    @patch.dict(os.environ, {'CCTV_LABEL_MODE': 'qr', 'CCTV_AI_API_KEY': ''})
    def test_stats_separate_no_qr_unreadable_and_non_invoice(self):
        qr_stats_snapshot_and_reset()
        blank = qr('x')
        blank[:] = 255
        ocr(blank)
        ocr(qr('BARCODE_12345'))
        ocr(qr('061026-23'))
        self.assertEqual({"dipindai": 3, "qr_terlihat": 2, "terbaca": 2, "invoice": 1},
                         qr_stats_snapshot_and_reset())

    @patch.dict(os.environ, {'CCTV_LABEL_MODE': 'qr'})
    def test_rotated_invoice_preserves_zero_without_inventing_customer(self):
        frame = qr('061026-23')
        for rotation in (None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180,
                         cv2.ROTATE_90_COUNTERCLOCKWISE):
            image = frame if rotation is None else cv2.rotate(frame, rotation)
            label = ocr(image)
            self.assertEqual('061026-23', label['field_one'])
            self.assertIsNone(label['field_two'])
            self.assertIsNone(label['field_three'])

    @patch.dict(os.environ, {'CCTV_LABEL_MODE': 'qr'})
    def test_url_is_not_an_invoice(self):
        self.assertIsNone(ocr(qr('https://example.com/061026-23')))

    @patch.dict(os.environ, {'CCTV_LABEL_MODE': 'qr'})
    def test_multiline_thermal_qr_extracts_invoice_customer_and_store(self):
        payload = (
            "INVOICE: 121026-23\n"
            "CUSTOMER: ARI BOGOR\n"
            "ALAMAT: TOKO\n"
            "ASAL: SIP : AJ\n"
            "PETUGAS: RIDHO AL AMZAH"
        )
        frame = qr(payload)
        for rotation in (None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180,
                         cv2.ROTATE_90_COUNTERCLOCKWISE):
            image = frame if rotation is None else cv2.rotate(frame, rotation)
            label = ocr(image)
            self.assertIsNotNone(label)
            self.assertEqual('121026-23', label['field_one'])
            self.assertEqual('ARI BOGOR', label['field_two'])
            self.assertEqual('Aneka Jaya', label['field_three'])
            self.assertEqual(1.0, label['confidence'])

    @patch.dict(os.environ, {'CCTV_LABEL_MODE': 'qr'})
    def test_delimiter_qr_extracts_fields(self):
        frame = qr("121026-23 | BUDI SUKABUMI | MJ")
        label = ocr(frame)
        self.assertIsNotNone(label)
        self.assertEqual('121026-23', label['field_one'])
        self.assertEqual('BUDI SUKABUMI', label['field_two'])
        self.assertEqual('MJ', label['field_three'])

    @patch.dict(os.environ, {'CCTV_LABEL_MODE': 'qr'})
    def test_two_different_invoices_are_not_guessed(self):
        self.assertIsNone(ocr(cv2.hconcat([qr('061026-23'), qr('061026-24')])))


if __name__ == '__main__':
    unittest.main()
