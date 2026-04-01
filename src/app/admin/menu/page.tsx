"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, LogOut } from "lucide-react";
import type { Branch, MenuItem, MenuCategory } from "@/types";

interface MenuItemWithCategory extends MenuItem {
  category?: { name: string } | null;
}

export default function AdminMenuPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItemWithCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 表單狀態
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [fName, setFName] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fPrice, setFPrice] = useState("0");
  const [fCategoryId, setFCategoryId] = useState("");
  const [fImageUrl, setFImageUrl] = useState("");
  const [fOrder, setFOrder] = useState("0");

  // 分類表單
  const [catFormOpen, setCatFormOpen] = useState(false);
  const [catName, setCatName] = useState("");

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        setBranches(list);
        if (list.length > 0) setBranchId(list[0].id);
      });
  }, []);

  const loadData = async (bid: string) => {
    if (!bid) return;
    setLoading(true);
    setError(null);
    try {
      const [itemRes, catRes] = await Promise.all([
        fetch(`/api/admin/menu-items?branchId=${encodeURIComponent(bid)}`),
        fetch(`/api/menu?branchId=${encodeURIComponent(bid)}`),
      ]);
      const itemData = await itemRes.json();
      const catData = await catRes.json();
      setItems(Array.isArray(itemData) ? itemData : []);
      setCategories(Array.isArray(catData?.categories) ? catData.categories : []);
    } catch {
      setError("載入失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (branchId) loadData(branchId);
  }, [branchId]);

  const openAdd = () => {
    setEditing(null);
    setFName(""); setFDesc(""); setFPrice("0");
    setFCategoryId(categories[0]?.id ?? "");
    setFImageUrl(""); setFOrder("0");
    setFormOpen(true);
  };

  const openEdit = (item: MenuItem) => {
    setEditing(item);
    setFName(item.name);
    setFDesc(item.description ?? "");
    setFPrice(String(item.price));
    setFCategoryId(item.category_id ?? "");
    setFImageUrl(item.image_url ?? "");
    setFOrder(String(item.display_order));
    setFormOpen(true);
  };

  const submitItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (editing) {
        const res = await fetch(`/api/admin/menu-items/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: fName.trim(),
            description: fDesc.trim() || null,
            price: Number(fPrice),
            category_id: fCategoryId || null,
            image_url: fImageUrl.trim() || null,
            display_order: Number(fOrder),
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
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
            image_url: fImageUrl.trim() || null,
            display_order: Number(fOrder),
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
      }
      setFormOpen(false);
      loadData(branchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗");
    }
  };

  const deleteItem = async (id: string) => {
    if (!confirm("確定要刪除此餐點嗎？")) return;
    await fetch(`/api/admin/menu-items/${id}`, { method: "DELETE" });
    loadData(branchId);
  };

  const toggleAvailable = async (item: MenuItem) => {
    await fetch(`/api/admin/menu-items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_available: !item.is_available }),
    });
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, is_available: !item.is_available } : i))
    );
  };

  const addCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    const res = await fetch("/api/admin/menu-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch_id: branchId, name: catName.trim() }),
    });
    if (res.ok) {
      setCatName("");
      setCatFormOpen(false);
      loadData(branchId);
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
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
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
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* 分類區 */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">菜單分類</h2>
            <button
              type="button"
              onClick={() => setCatFormOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            >
              <Plus className="h-4 w-4" /> 新增分類
            </button>
          </div>
          {categories.length === 0 ? (
            <p className="text-sm text-gray-500">尚無分類</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <span key={c.id} className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-800">
                  {c.name}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* 餐點列表 */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">餐點列表</h2>
            <button
              type="button"
              onClick={openAdd}
              disabled={!branchId}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> 新增餐點
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">載入中…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-gray-500">尚無餐點</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-3 first:pt-0">
                  {item.image_url && (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="h-12 w-12 rounded-lg object-cover shrink-0"
                    />
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
                          已下架
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-amber-700 font-medium">${item.price}</p>
                    {item.description && (
                      <p className="text-xs text-gray-500 truncate">{item.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleAvailable(item)}
                      className="text-gray-500 hover:text-gray-700"
                      title={item.is_available ? "下架" : "上架"}
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
                      className="rounded border border-gray-300 p-1 text-gray-600 hover:bg-gray-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteItem(item.id)}
                      className="rounded border border-red-200 p-1 text-red-600 hover:bg-red-50"
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
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">
              {editing ? "編輯餐點" : "新增餐點"}
            </h3>
            <form onSubmit={submitItem} className="space-y-3">
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
                <label className="block text-sm font-medium text-gray-700 mb-1">圖片 URL</label>
                <input
                  type="url"
                  value={fImageUrl} onChange={(e) => setFImageUrl(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="https://..."
                />
              </div>
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
                  className="flex-1 rounded-lg bg-amber-600 py-2 text-white hover:bg-amber-700"
                >
                  儲存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 新增分類 Modal */}
      {catFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">新增分類</h3>
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
                  className="flex-1 rounded-lg bg-amber-600 py-2 text-white hover:bg-amber-700"
                >
                  新增
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
