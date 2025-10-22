"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { logActivity, autoLogActivity } from "@/app/lib/activity";
import dynamic from "next/dynamic";
import React from "react";

const RichTextEditor = dynamic(() => import("./RichTextEditor"), { ssr: false });

type Showroom = {
  id: number;
  title: string;
  address: string;
  description: string;
  image?: string;
};

export default function AdminShowroomsPage() {
  const [showrooms, setShowrooms] = useState<Showroom[]>([]);
  const [form, setForm] = useState<Partial<Showroom>>({});
  const [editingShowroom, setEditingShowroom] = useState<Showroom | null>(null);
  const [originalEditingShowroom, setOriginalEditingShowroom] = useState<Showroom | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [adding, setAdding] = useState(false); 
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    // Load current admin and log page access
    const loadAdmin = async () => {
      try {
        const sessionData = localStorage.getItem('adminSession');
        if (sessionData) {
          const admin = JSON.parse(sessionData);
          setCurrentAdmin(admin);
          
          // Log page access
          await logActivity({
            admin_id: admin.id,
            admin_name: admin.username,
            action: 'view',
            entity_type: 'page',
            details: `Admin ${admin.username} accessed Showrooms management page`,
            page: 'Showrooms',
            metadata: {
              pageAccess: true,
              adminAccount: admin.username,
              adminId: admin.id,
              timestamp: new Date().toISOString(),
              userAgent: navigator.userAgent
            }
          });
        }
      } catch (error) {
        console.error("Error loading admin:", error);
      }
    };

    loadAdmin();
  }, []);

  useEffect(() => {
    if (currentAdmin) {
      fetchShowrooms();
    }
  }, [currentAdmin]);

  // ADD: page view activity
  useEffect(() => {
    if (currentAdmin) {
      autoLogActivity('view', 'page', `Accessed Showrooms page`, {
        page: 'Showrooms',
        metadata: { section: 'Showrooms', timestamp: new Date().toISOString() }
      });
    }
  }, [currentAdmin]);

  const fetchShowrooms = async () => {
    try {
      const { data, error } = await supabase
        .from("showrooms")
        .select("*")
        .order("id", { ascending: true });
      
      if (!error) {
        setShowrooms(data || []);
        
        // Log successful data load
        if (currentAdmin) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: 'showrooms',
            details: `Admin ${currentAdmin.username} loaded ${data?.length || 0} showrooms`,
            page: 'Showrooms',
            metadata: {
              showroomsCount: data?.length || 0,
              adminAccount: currentAdmin.username,
              adminId: currentAdmin.id,
              timestamp: new Date().toISOString()
            }
          });
        }
      } else {
        console.error("Error fetching showrooms:", error.message);
        
        // Log error
        if (currentAdmin) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: 'showrooms_error',
            details: `Admin ${currentAdmin.username} failed to load showrooms: ${error.message}`,
            page: 'Showrooms',
            metadata: {
              error: error.message,
              adminAccount: currentAdmin.username,
              timestamp: new Date().toISOString()
            }
          });
        }
      }
    } catch (error) {
      console.error("Exception fetching showrooms:", error);
    }
  };

  const handleAddModalOpen = async () => {
    setAdding(true);
    
    // Log add modal opening
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'showroom_add_modal',
        details: `Admin ${currentAdmin.username} opened add new showroom modal`,
        page: 'Showrooms',
        metadata: {
          action: 'add_modal_opened',
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const handleAddModalClose = async () => {
    setAdding(false);
    setForm({});
    
    // Log add modal closing
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'showroom_add_cancelled',
        details: `Admin ${currentAdmin.username} cancelled adding new showroom`,
        page: 'Showrooms',
        metadata: {
          action: 'add_cancelled',
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentAdmin) return;
    
    setUploading(true);
    
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Date.now()}-${Math.random()
        .toString(36)
        .substring(2)}.${fileExt}`;
      
      const { error } = await supabase.storage
        .from("showroom-images")
        .upload(fileName, file);

      if (error) {
        alert("Image upload failed.");
        
        // Log upload error
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "upload",
          entity_type: "showroom_image_error",
          details: `Admin ${currentAdmin.username} failed to upload image for showroom: ${error.message}`,
          page: "Showrooms",
          metadata: {
            fileName: file.name,
            fileSize: file.size,
            error: error.message,
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
        
        setUploading(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("showroom-images")
        .getPublicUrl(fileName);

      const imageUrl = urlData?.publicUrl || "";
      
      if (editingShowroom) {
        setEditingShowroom({ ...editingShowroom, image: imageUrl });
      } else {
        setForm({ ...form, image: imageUrl });
      }

      // Log successful image upload
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "upload",
        entity_type: "showroom_image",
        details: `Admin ${currentAdmin.username} uploaded image for showroom: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
        page: "Showrooms",
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          fileSizeMB: (file.size / 1024 / 1024).toFixed(2),
          fileType: file.type,
          uploadPath: fileName,
          imageUrl: imageUrl,
          bucketName: "showroom-images",
          isEditMode: !!editingShowroom,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
      
      setUploading(false);
    } catch (err: any) {
      console.error("upload threw", err);
      alert("Error uploading file: " + (err?.message || String(err)));
      setUploading(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !currentAdmin) {
      alert("Showroom title is required");
      return;
    }
    
    try {
      const { data, error } = await supabase.from("showrooms").insert([form]).select();
      
      if (!error && data) {
        // Enhanced activity logging for showroom creation
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "showroom",
          entity_id: data[0].id.toString(),
          details: `Admin ${currentAdmin.username} created new showroom "${form.title}"`,
          page: "Showrooms",
          metadata: {
            showroomId: data[0].id,
            showroomTitle: form.title,
            showroomAddress: form.address,
            showroomDescription: form.description,
            hasImage: !!form.image,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });

        fetchShowrooms();
        setForm({});
        setAdding(false); // close popup
      } else {
        console.error("Error adding showroom:", error);
        
        // Log add error
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "showroom_error",
          details: `Admin ${currentAdmin.username} failed to create showroom "${form.title}": ${error?.message}`,
          page: "Showrooms",
          metadata: {
            showroomTitle: form.title,
            error: error?.message,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      console.error("Exception adding showroom:", error);
    }
  };

  const startEdit = async (showroom: Showroom) => {
    setEditingShowroom(showroom);
    setOriginalEditingShowroom(JSON.parse(JSON.stringify(showroom))); // Deep copy
    
    // Log edit initiation
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'showroom_edit_start',
        entity_id: showroom.id.toString(),
        details: `Admin ${currentAdmin.username} started editing showroom "${showroom.title}"`,
        page: 'Showrooms',
        metadata: {
          showroomId: showroom.id,
          showroomTitle: showroom.title,
          action: 'edit_started',
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingShowroom || !originalEditingShowroom || !currentAdmin) return;

    try {
      // Calculate changes for detailed logging
      const changes: Array<{field: string, oldValue: any, newValue: any}> = [];
      (['title', 'address', 'description', 'image'] as (keyof Showroom)[]).forEach((field) => {
        const oldVal = originalEditingShowroom[field];
        const newVal = editingShowroom[field];
        
        if (oldVal !== newVal) {
          changes.push({
            field: field,
            oldValue: oldVal,
            newValue: newVal
          });
        }
      });

      const { error } = await supabase
        .from("showrooms")
        .update({
          title: editingShowroom.title,
          address: editingShowroom.address,
          description: editingShowroom.description,
          image: editingShowroom.image,
        })
        .eq("id", editingShowroom.id);

      if (!error) {
        // Enhanced activity logging for showroom update
        if (changes.length > 0) {
          const changesSummary = changes.map(c => `${c.field}: "${c.oldValue || ''}" → "${c.newValue || ''}"`);
          
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: "update",
            entity_type: "showroom",
            entity_id: editingShowroom.id.toString(),
            details: `Admin ${currentAdmin.username} updated showroom "${originalEditingShowroom.title}" with ${changes.length} changes: ${changesSummary.slice(0, 2).join("; ")}${changesSummary.length > 2 ? "..." : ""}`,
            page: "Showrooms",
            metadata: {
              showroomId: editingShowroom.id,
              originalTitle: originalEditingShowroom.title,
              newTitle: editingShowroom.title,
              adminAccount: currentAdmin.username,
              adminId: currentAdmin.id,
              changesCount: changes.length,
              changes: changesSummary,
              detailedChanges: changes,
              updateSummary: {
                titleChanged: changes.some(c => c.field === 'title'),
                addressChanged: changes.some(c => c.field === 'address'),
                descriptionChanged: changes.some(c => c.field === 'description'),
                imageChanged: changes.some(c => c.field === 'image')
              },
              timestamp: new Date().toISOString()
            }
          });

          // Log specific field changes
          for (const change of changes) {
            await logActivity({
              admin_id: currentAdmin.id,
              admin_name: currentAdmin.username,
              action: "update",
              entity_type: `showroom_${change.field}`,
              entity_id: editingShowroom.id.toString(),
              details: `Admin ${currentAdmin.username} updated showroom ${change.field}: "${change.oldValue || ''}" → "${change.newValue || ''}"`,
              page: "Showrooms",
              metadata: {
                showroomId: editingShowroom.id,
                showroomTitle: originalEditingShowroom.title,
                fieldName: change.field,
                oldValue: change.oldValue,
                newValue: change.newValue,
                adminAccount: currentAdmin.username,
                adminId: currentAdmin.id,
                timestamp: new Date().toISOString()
              }
            });
          }
        }

        fetchShowrooms();
        setEditingShowroom(null);
        setOriginalEditingShowroom(null);
      } else {
        console.error("Error updating showroom:", error);
      }
    } catch (error) {
      console.error("Exception updating showroom:", error);
    }
  };

  const cancelEdit = async () => {
    if (currentAdmin && editingShowroom) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'showroom_edit_cancelled',
        entity_id: editingShowroom.id.toString(),
        details: `Admin ${currentAdmin.username} cancelled editing showroom "${editingShowroom.title}"`,
        page: 'Showrooms',
        metadata: {
          showroomId: editingShowroom.id,
          showroomTitle: editingShowroom.title,
          action: 'edit_cancelled',
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    setEditingShowroom(null);
    setOriginalEditingShowroom(null);
  };

  const handleDelete = async (id: number) => {
    if (!currentAdmin) return;

    const showroomToDelete = showrooms.find(s => s.id === id);
    
    if (!confirm(`Are you sure you want to delete the showroom "${showroomToDelete?.title}"?`)) {
      // Log deletion cancelled
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'showroom_delete_cancelled',
        entity_id: id.toString(),
        details: `Admin ${currentAdmin.username} cancelled deletion of showroom "${showroomToDelete?.title}"`,
        page: 'Showrooms',
        metadata: {
          showroomId: id,
          showroomTitle: showroomToDelete?.title,
          action: 'delete_cancelled',
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
      return;
    }

    try {
      const { error } = await supabase.from("showrooms").delete().eq("id", id);
      
      if (!error) {
        // Enhanced activity logging for showroom deletion
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "delete",
          entity_type: "showroom",
          entity_id: id.toString(),
          details: `Admin ${currentAdmin.username} deleted showroom "${showroomToDelete?.title}"`,
          page: "Showrooms",
          metadata: {
            showroomId: id,
            deletedShowroom: {
              title: showroomToDelete?.title,
              address: showroomToDelete?.address,
              description: showroomToDelete?.description,
              image: showroomToDelete?.image
            },
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            remainingShowroomsCount: showrooms.length - 1,
            timestamp: new Date().toISOString()
          }
        });

        fetchShowrooms();
      } else {
        console.error("Error deleting showroom:", error);
      }
    } catch (error) {
      console.error("Exception deleting showroom:", error);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-blue-700">🏢 Admin Showrooms</h1>
        <div className="flex items-center gap-4">
          <div className="text-sm text-black">
            Editing as: {currentAdmin?.username || 'Unknown Admin'}
          </div>
          <button
            onClick={handleAddModalOpen}
            className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition-colors"
          >
            ➕ Add Showroom
          </button>
        </div>
      </div>

      {/* Showrooms Table */}
      <div className="bg-white rounded-xl shadow p-6 border border-gray-200">
        <h2 className="text-lg font-semibold mb-4 text-black">📋 Showrooms List</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-blue-600 text-white text-left">
                <th className="p-3">ID</th>
                <th className="p-3">Title</th>
                <th className="p-3">Address</th>
                <th className="p-3">Description</th>
                <th className="p-3">Image</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {showrooms.map((s, idx) => (
                <tr
                  key={s.id}
                  className={`${
                    idx % 2 === 0 ? "bg-white" : "bg-gray-50"
                  } hover:bg-gray-100 transition-colors text-black`}
                >
                  <td className="p-3 font-medium">{s.id}</td>
                  <td className="p-3 font-medium">{s.title}</td>
                  <td className="p-3">{s.address}</td>
                  <td className="p-3 line-clamp-2 max-w-[250px]">
                    <div dangerouslySetInnerHTML={{ __html: s.description }} className="text-sm" />
                  </td>
                  <td className="p-3">
                    {s.image ? (
                      <img
                        src={s.image}
                        alt={s.title}
                        className="h-12 w-20 object-cover rounded-md border"
                      />
                    ) : (
                      <span className="text-black">—</span>
                    )}
                  </td>
                  <td className="p-3 flex gap-2 justify-center">
                    <button
                      onClick={() => startEdit(s)}
                      className="px-3 py-1 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
                    >
                      🗑 Delete
                    </button>
                  </td>
                </tr>
              ))}
              {showrooms.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="p-8 text-center text-gray-500"
                  >
                    <div className="text-6xl mb-4">🏢</div>
                    <h3 className="text-lg font-medium text-black mb-2">No showrooms yet</h3>
                    <p className="text-black">Create your first showroom to get started!</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Showroom Modal */}
      {adding && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl p-8 overflow-y-auto max-h-[90vh]">
            <h2 className="text-xl font-bold mb-6 text-gray-900">➕ Add Showroom</h2>
            <form onSubmit={handleAdd} className="grid gap-4">
              <div>
                <label className="block text-sm font-medium text-black mb-1">Showroom Title *</label>
                <input
                  type="text"
                  placeholder="Showroom Title"
                  value={form.title || ""}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full p-3 border rounded-md text-black focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-black mb-1">Address</label>
                <input
                  type="text"
                  placeholder="Address"
                  value={form.address || ""}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full p-3 border rounded-md text-black focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-1">Showroom Image</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={uploading}
                  className="w-full p-3 border rounded-md text-black"
                />
                {uploading && (
                  <div className="mt-2 text-blue-600 text-sm">
                    📤 Uploading image...
                  </div>
                )}
                {form.image && (
                  <div className="mt-4">
                    <img
                      src={form.image}
                      alt="Preview"
                      className="h-32 w-48 object-cover rounded-md border"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-1">Description</label>
                <RichTextEditor
                  value={form.description || ""}
                  onChange={(desc) => setForm({ ...form, description: desc })}
                />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleAddModalClose}
                  className="bg-gray-400 text-white px-5 py-2 rounded-md hover:bg-gray-500 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-green-600 text-white px-5 py-2 rounded-md hover:bg-green-700 transition-colors"
                  disabled={uploading || !form.title}
                >
                  {uploading ? "Uploading..." : "Add Showroom"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingShowroom && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl p-8 overflow-y-auto max-h-[90vh]">
            <h2 className="text-xl font-bold mb-6 text-gray-900">✏️ Edit Showroom</h2>
            <form onSubmit={saveEdit} className="grid gap-4">
              <div>
                <label className="block text-sm font-medium text-black mb-1">Showroom Title *</label>
                <input
                  type="text"
                  placeholder="Showroom Title"
                  value={editingShowroom.title}
                  onChange={(e) =>
                    setEditingShowroom({ ...editingShowroom, title: e.target.value })
                  }
                  className="w-full p-3 border rounded-md text-black focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-1">Address</label>
                <input
                  type="text"
                  placeholder="Address"
                  value={editingShowroom.address}
                  onChange={(e) =>
                    setEditingShowroom({ ...editingShowroom, address: e.target.value })
                  }
                  className="w-full p-3 border rounded-md text-black focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-1">Showroom Image</label>
                {editingShowroom.image && (
                  <div className="mb-4">
                    <img
                      src={editingShowroom.image}
                      alt="Current"
                      className="h-32 w-48 object-cover rounded-md border"
                    />
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={uploading}
                  className="w-full p-3 border rounded-md text-black"
                />
                {uploading && (
                  <div className="mt-2 text-blue-600 text-sm">
                    📤 Uploading image...
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-black mb-1">Description</label>
                <RichTextEditor
                  value={editingShowroom.description || ""}
                  onChange={(desc) =>
                    setEditingShowroom({ ...editingShowroom, description: desc })
                  }
                />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="bg-gray-400 text-white px-5 py-2 rounded-md hover:bg-gray-500 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-600 text-white px-5 py-2 rounded-md hover:bg-blue-700 transition-colors"
                  disabled={uploading}
                >
                  {uploading ? "Uploading..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
