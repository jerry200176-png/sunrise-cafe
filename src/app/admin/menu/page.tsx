"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, LogOut, RefreshCw } from "lucide-react";
import type { MenuItem, MenuCategory } from "@/types";
import { responseError, thrownMessage } from "@/lib/friendly-error";
import { fetchWithTimeout, readJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { useAdminBranches } from "@/lib/use-admin-branches";
import { OptionSetsPanel } from "@/components/admin/OptionSetsPanel";
import type { OptionSetView } from "@/lib/option-sets-db";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ToastStack, type ToastItem, type ToastVariant } from "@/components/Toast";

// 手機原圖常 3–5 MB，直接上傳很慢；先在瀏覽器縮到 1200px JPEG（約 100–300 KB）。
async function shrinkPhoto(file: File): Promise<File> {
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // 透明 PNG 轉 JPEG 時不要變黑底
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

interface MenuItemWithCategory extends MenuItem {
  category?: { name: string } | null;
  option_set_ids?: string[];
}

export default function AdminMenuPage() {
  const { branches, loading: branchesLoading, error: branchesError, retry: retryBranches } = useAdminBranches();
  const [branchId, setBranchId] = useState<string>("");
  // Keep old branch data inaccessible while the current scope is being confirmed.
  const branchUnavailable = branchesLoading || Boolean(branchesError) || (Boolean(branchId) && !branches.some((branch) => branch.id === branchId));
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItemWithCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [menuUrl, setMenuUrl] = useState("");
  const [copyingMenuUrl, setCopyingMenuUrl] = useState(false);
  const copyingMenuUrlRef = useRef(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // 表單狀態
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [fName, setFName] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fPrice, setFPrice] = useState("0");
  const [fCategoryId, setFCategoryId] = useState("");
  const [fImageUrl, setFImageUrl] = useState("");
  const [fImageFile, setFImageFile] = useState<File | null>(null);
  const [fSetIds, setFSetIds] = useState<string[]>([]);
  const [optionSets, setOptionSets] = useState<OptionSetView[]>([]);
  const [fOrder, setFOrder] = useState("0");
  const [fPreorderEligible, setFPreorderEligible] = useState(false);

  // 分類表單
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [catEditing, setCatEditing] = useState<MenuCategory | null>(null);

  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);
  const requestSequence = useRef(0);
  const activeBranchId = useRef(branchId);

  const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    setMenuUrl(`${window.location.origin}/menu`);
  }, []);

  const copyMenuUrl = async () => {
    if (!menuUrl || copyingMenuUrlRef.current) return;
    copyingMenuUrlRef.current = true;
    setCopyingMenuUrl(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(menuUrl);
      showToast("已複製菜單網址", "success");
    } catch {
      showToast("無法自動複製，請選取菜單網址欄位後手動複製", "error");
    } finally {
      copyingMenuUrlRef.current = false;
      setCopyingMenuUrl(false);
    }
  };

  useEffect(() => {
    if (!branchId && branches.length > 0) { activeBranchId.current = branches[0].id; setBranchId(branches[0].id); }
    else if (branchId && !branches.some((branch) => branch.id === branchId)) {
      requestSequence.current++;
      activeBranchId.current = "";
      setBranchId("");
      setItems([]); setCategories([]); setOptionSets([]);
      setError(null); setLoading(false);
      setFormOpen(false); setEditing(null); setCatFormOpen(false); setCatEditing(null); setConfirmDeleteItemId(null);
    }
  }, [branches, branchId]);

  const loadData = async (bid: string) => {
    if (bid !== activeBranchId.current) return;
    const current = ++requestSequence.current;
    if (!bid) {
      setItems([]); setCategories([]); setOptionSets([]); setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [itemRes, catRes, setRes] = await Promise.all([
        fetchWithTimeout(`/api/admin/menu-items?branchId=${encodeURIComponent(bid)}`, { credentials: "include" }),
        fetchWithTimeout(`/api/admin/menu-categories?branchId=${encodeURIComponent(bid)}`, { credentials: "include" }),
        fetchWithTimeout(`/api/admin/menu-option-sets?branchId=${encodeURIComponent(bid)}`, { credentials: "include" }),
      ]);
      for (const res of [itemRes, catRes, setRes]) if (!res.ok) throw new Error(await responseError(res));
      const [itemData, catData, setData] = await Promise.all([
        readJsonWithTimeout<MenuItemWithCategory[]>(itemRes),
        readJsonWithTimeout<MenuCategory[]>(catRes),
        readJsonWithTimeout<OptionSetView[]>(setRes),
      ]);
      if (![itemData, catData, setData].every(Array.isArray)) throw new Error("菜單資料格式不正確，請重試");
      if (current !== requestSequence.current || bid !== activeBranchId.current) return;
      setOptionSets(setData as OptionSetView[]);
      setItems(itemData as MenuItemWithCategory[]);
      setCategories(catData as MenuCategory[]);
    } catch (cause) {
      if (current === requestSequence.current && bid === activeBranchId.current) {
        setItems([]); setCategories([]); setOptionSets([]);
        setError(thrownMessage(cause, "菜單載入失敗，請重試"));
      }
    } finally {
      if (current === requestSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(branchId);
  }, [branchId]);

  const openAdd = () => {
    setEditing(null);
    setFName(""); setFDesc(""); setFPrice("0");
    setFCategoryId(categories[0]?.id ?? "");
    setFImageUrl(""); setFOrder("0");
    setFImageFile(null); setFSetIds([]);
    setFPreorderEligible(false);
    setModalError(null);
    setFormOpen(true);
  };

  const openEdit = (item: MenuItem) => {
    setEditing(item);
    setFName(item.name);
    setFDesc(item.description ?? "");
    setFPrice(String(item.price));
    setFCategoryId(item.category_id ?? "");
    setFImageUrl(item.image_url ?? "");
    setFImageFile(null);
    setFSetIds((item as MenuItemWithCategory).option_set_ids ?? []);
    setFOrder(String(item.display_order));
    setFPreorderEligible(Boolean(item.preorder_eligible));
    setModalError(null);
    setFormOpen(true);
  };

  const submitItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setModalError(null);
    setSaving(true);
    try {
      let imageUrl = fImageUrl.trim() || null;
      if (fImageFile) {
        const form = new FormData();
        form.append("branch_id", branchId);
        form.append("photo", await shrinkPhoto(fImageFile));
        const upload = await fetch("/api/admin/menu-photos", { method: "POST", body: form });
        if (!upload.ok) throw new Error(await responseError(upload));
        const result = await upload.json();
        imageUrl = result.url;
      }
      if (editing) {
        const res = await fetch(`/api/admin/menu-items/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: fName.trim(),
            description: fDesc.trim() || null,
            price: Number(fPrice),
            category_id: fCategoryId || null,
            image_url: imageUrl,
            option_set_ids: fSetIds,
            display_order: Number(fOrder),
            preorder_eligible: fPreorderEligible,
          }),
        });
        if (!res.ok) throw new Error(await responseError(res));
      } else {
        const res = await fetch("/api/admin/menu-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branch_id: branchId,
            name: fName.trim(),
            description: fDesc.trim() || null,
            price: Number(fPrice),
            category_id: fCategoryId || null,
            image_url: imageUrl,
            option_set_ids: fSetIds,
            display_order: Number(fOrder),
            preorder_eligible: fPreorderEligible,
          }),
        });
        if (!res.ok) throw new Error(await responseError(res));
      }
      setFormOpen(false);
      loadData(branchId);
    } catch (err) {
      setModalError(thrownMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/menu-items/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await responseError(res));
      loadData(branchId);
      showToast("已刪除餐點", "success");
    } catch (err) {
      const msg = thrownMessage(err, "刪除失敗，請稍後再試");
      setError(msg);
      showToast(msg, "error");
    }
  };

  const toggleAvailable = async (item: MenuItem) => {
    try {
      const res = await fetch(`/api/admin/menu-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_available: !item.is_available }),
      });
      if (!res.ok) {
        showToast(`沒改成：${await responseError(res)}`, "error");
        return;
      }
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, is_available: !item.is_available } : i))
      );
    } catch (err) {
      showToast(`沒改成：${thrownMessage(err)}`, "error");
    }
  };

  const addCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim() || saving) return;
    setSaving(true);
    setModalError(null);
    try {
      const res = await fetch(catEditing ? `/api/admin/menu-categories/${catEditing.id}` : "/api/admin/menu-categories", {
        method: catEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch_id: branchId, name: catName.trim() }),
      });
      if (!res.ok) {
        setModalError(await responseError(res));
        return;
      }
      setCatName("");
      setCatEditing(null);
      setCatFormOpen(false);
      loadData(branchId);
    } catch (err) {
      setModalError(thrownMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-gray-600 hover:text-gray-900">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-lg font-bold text-gray-900">菜單管理</h1>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="選擇分店"
              id="menu-branch"
              value={branchId}
              onChange={(e) => {
                const nextBranchId = e.target.value;
                requestSequence.current++;
                activeBranchId.current = nextBranchId;
                setItems([]); setCategories([]); setOptionSets([]);
                setError(null); setLoading(Boolean(nextBranchId));
              setFormOpen(false); setEditing(null); setCatFormOpen(false); setCatEditing(null); setConfirmDeleteItemId(null);
                setBranchId(nextBranchId);
              }}
              disabled={saving || branchesLoading || Boolean(branchesError)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <button
              type="button"
              aria-label="重新整理分店"
              title="重新整理分店"
              onClick={() => void retryBranches()}
              disabled={saving || branchesLoading}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/admin/logout", { method: "POST" });
                window.location.href = "/admin/login";
              }}
              className="rounded-lg border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-50"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-stone-900">官方 LINE 菜單網址</p>
          <p className="text-sm text-stone-600">客人無須訂位即可瀏覽，開啟後選擇分店。</p>
          <label htmlFor="menu-url" className="mt-3 block text-sm text-stone-700">菜單網址（可手動複製）</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input id="menu-url" type="text" readOnly value={menuUrl} className="min-h-[44px] w-full rounded-lg border border-amber-300 bg-white px-3 text-sm text-stone-900 sm:min-w-0 sm:flex-1" />
            <button type="button" onClick={() => void copyMenuUrl()} disabled={!menuUrl || copyingMenuUrl} className="min-h-[44px] rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{copyingMenuUrl ? "複製中…" : "複製網址"}</button>
            <a href="/menu" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-medium text-amber-900 underline">開啟菜單（新分頁）</a>
          </div>
          {copyingMenuUrl && <p role="status" className="mt-1 text-sm text-stone-700">正在複製菜單網址…</p>}
        </div>
        {error && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            <span>{error}</span><button type="button" onClick={() => void loadData(branchId)} disabled={!branchId || branchUnavailable || loading} className="min-h-[44px] rounded-lg border border-red-300 bg-white px-3 disabled:opacity-50">重試</button>
          </div>
        )}
        {branchesError && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800"><span>{branchesError}</span><button type="button" onClick={() => void retryBranches()} disabled={branchesLoading} className="min-h-[44px] rounded-lg border border-red-300 bg-white px-3 disabled:opacity-50">重試分店</button></div>}
        {branchesLoading && <p role="status" className="text-sm text-gray-500">載入分店中…</p>}
        {!branchesLoading && !branchesError && branches.length === 0 && <p role="status" className="rounded-lg bg-stone-100 px-4 py-3 text-sm text-stone-600">目前沒有可管理的分店。</p>}

        {/* 分類區 */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">菜單分類</h2>
            <button
              type="button"
              onClick={() => { setCatEditing(null); setCatName(""); setModalError(null); setCatFormOpen(true); }}
              disabled={!branchId || branchUnavailable || loading || Boolean(error)}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            >
              <Plus className="h-4 w-4" /> 新增分類
            </button>
          </div>
          {loading ? <p role="status" className="text-sm text-gray-500">載入分類中…</p> : error || !branchId || branchUnavailable ? null : categories.length === 0 ? (
            <p className="text-sm text-gray-500">尚無分類</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <div key={c.id} className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-800">
                  <span>{c.name}{!c.is_active ? "（客人看不到）" : ""}</span>
                  <button type="button" aria-label={`編輯${c.name}`} onClick={() => { setCatEditing(c); setCatName(c.name); setModalError(null); setCatFormOpen(true); }}><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={async () => {
                    const res = await fetch(`/api/admin/menu-categories/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !c.is_active }) });
                    if (!res.ok) setError(await responseError(res)); else loadData(branchId);
                  }} className="text-xs underline">{c.is_active ? "隱藏" : "顯示"}</button>
                </div>
              ))}
            </div>
          )}
        </section>

        {branchId && !branchUnavailable && !loading && !error && <OptionSetsPanel
          branchId={branchId}
          sets={optionSets}
          categories={categories}
          items={items}
          onChanged={() => loadData(branchId)}
          notify={showToast}
        />}

        {/* 餐點列表 */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">餐點列表</h2>
            <button
              type="button"
              onClick={openAdd}
              disabled={!branchId || branchUnavailable || loading || Boolean(error)}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> 新增餐點
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">載入中…</p>
          ) : error || !branchId || branchUnavailable ? null : items.length === 0 ? (
            <p className="text-sm text-gray-500">尚無餐點</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-3 first:pt-0">
                  {item.image_url && (
                    <div className="relative h-12 w-12 rounded-lg shrink-0 overflow-hidden">
                      <Image
                        src={item.image_url}
                        alt={item.name}
                        fill
                        sizes="48px"
                        className="object-cover"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900 truncate">{item.name}</p>
                      {item.category && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          {item.category.name}
                        </span>
                      )}
                      {!item.is_available && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                          已售完
                        </span>
                      )}
                      {item.preorder_eligible && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">可在訂位時先點</span>
                      )}
                    </div>
                    <p className="text-sm text-amber-700 font-medium">${item.price}</p>
                    {item.description && (
                      <p className="text-xs text-gray-500 truncate">{item.description}</p>
                    )}
                    {(item.options ?? []).length > 0 && (
                      <p className="text-xs text-gray-400 truncate">
                        選項組：{[...new Set((item.options ?? []).map((o) => o.option_group))].join("、")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleAvailable(item)}
                      aria-label={item.is_available ? `${item.name} 供應中，點一下改成已售完` : `${item.name} 已售完，點一下改成供應中`}
                      className="flex h-11 w-11 items-center justify-center text-gray-500 hover:text-gray-700"
                      title={item.is_available ? "供應中，點一下改成已售完" : "已售完，點一下改成供應中"}
                    >
                      {item.is_available ? (
                        <ToggleRight className="h-6 w-6 text-green-600" />
                      ) : (
                        <ToggleLeft className="h-6 w-6 text-gray-400" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      aria-label={`編輯 ${item.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteItemId(item.id)}
                      aria-label={`刪除 ${item.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded border border-red-200 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 餐點表單 Modal */}
      {formOpen && !branchUnavailable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">
              {editing ? "編輯餐點" : "新增餐點"}
            </h3>
            {modalError && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{modalError}</p>}
            <form onSubmit={submitItem} className="space-y-3">
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={fPreorderEligible} onChange={(e) => setFPreorderEligible(e.target.checked)} />
                  可在訂位時先點
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名稱 *</label>
                <input
                  type="text" required
                  value={fName} onChange={(e) => setFName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="例：招牌拿鐵"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea
                  value={fDesc} onChange={(e) => setFDesc(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  rows={2}
                  placeholder="簡短介紹"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">價格 *</label>
                  <input
                    type="number" required min={0}
                    value={fPrice} onChange={(e) => setFPrice(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">排序</label>
                  <input
                    type="number" min={0}
                    value={fOrder} onChange={(e) => setFOrder(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">分類</label>
                <select
                  value={fCategoryId} onChange={(e) => setFCategoryId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                >
                  <option value="">無分類</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="menu-photo" className="block text-sm font-medium text-gray-700 mb-1">餐點照片</label>
                <input id="menu-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFImageFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                {fImageUrl && !fImageFile && (
                  // eslint-disable-next-line @next/next/no-img-element -- admin preview
                  <img src={fImageUrl} alt="目前照片" className="mt-1 h-16 w-16 rounded-lg object-cover" />
                )}
                {fImageUrl && !fImageFile && <button type="button" onClick={() => setFImageUrl("")} className="mt-1 text-xs text-rose-700 underline">移除目前照片</button>}
              </div>
              <fieldset className="border-t border-stone-200 pt-3">
                <legend className="text-sm font-semibold">選項組</legend>
                <p className="mb-1 text-xs text-stone-500">甜度、加料等客製選項。到下方「選項組」新增和修改內容。</p>
                {optionSets.length === 0 && <p className="text-sm text-stone-400">還沒有選項組</p>}
                {optionSets.map((set) => {
                  const viaCategory = Boolean(fCategoryId) && set.category_ids.includes(fCategoryId);
                  return (
                    <label key={set.id} className="flex min-h-[44px] items-center gap-2 text-sm">
                      <input type="checkbox" checked={viaCategory || fSetIds.includes(set.id)} disabled={viaCategory}
                        onChange={() => setFSetIds((old) => (old.includes(set.id) ? old.filter((x) => x !== set.id) : [...old, set.id]))} />
                      {set.name}
                      {viaCategory && <span className="text-xs text-stone-400">（整個分類都有）</span>}
                    </label>
                  );
                })}
              </fieldset>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="flex-1 rounded-lg border border-gray-300 py-2 text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-lg bg-amber-600 py-2 text-white hover:bg-amber-700 disabled:opacity-60"
                >
                  {saving ? "儲存中…" : "儲存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 新增分類 Modal */}
      {catFormOpen && !branchUnavailable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">{catEditing ? "編輯分類" : "新增分類"}</h3>
            {modalError && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{modalError}</p>}
                        <form onSubmit={addCategory} className="space-y-3">
              <input
                type="text" required
                value={catName} onChange={(e) => setCatName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                placeholder="例：咖啡飲品、甜點、輕食"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCatFormOpen(false)}
                  className="flex-1 rounded-lg border border-gray-300 py-2 text-gray-700"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-lg bg-amber-600 py-2 text-white hover:bg-amber-700 disabled:opacity-60"
                >
                  {saving ? "儲存中…" : "儲存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmDeleteItemId !== null && !branchUnavailable}
        title="刪除餐點"
        message="確定要刪除此餐點嗎？"
        confirmLabel="刪除"
        variant="danger"
        onConfirm={() => {
          const id = confirmDeleteItemId;
          setConfirmDeleteItemId(null);
          if (id) void deleteItem(id);
        }}
        onCancel={() => setConfirmDeleteItemId(null)}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
