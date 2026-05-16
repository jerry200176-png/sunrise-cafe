import Link from "next/link";
import { CheckCircle } from "lucide-react";

export default function WaitlistSuccessPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-amber-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm text-center">
        <div className="mb-4 flex justify-center">
          <CheckCircle size={48} className="text-amber-500" />
        </div>
        <h1 className="mb-2 text-xl font-bold text-gray-800">已加入等位清單</h1>
        <p className="mb-6 text-sm text-gray-500 leading-relaxed">
          若該時段有人取消，我們將優先以 LINE 通知您。<br />
          請確認您已加昇昇咖啡官方帳號為好友，並完成過訂位 LINE 綁定。
        </p>
        <div className="space-y-3">
          <Link
            href="/book"
            className="block w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-white hover:bg-amber-600"
          >
            查看其他時段
          </Link>
          <Link
            href="/"
            className="block w-full rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            回首頁
          </Link>
        </div>
      </div>
    </div>
  );
}
