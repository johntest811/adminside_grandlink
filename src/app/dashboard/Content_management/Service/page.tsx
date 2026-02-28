"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { logActivity, autoLogActivity } from "@/app/lib/activity";
import * as FaIcons from "react-icons/fa";

interface Service {
  id: number;
  name: string;
  short_description: string;
  long_description: string;
  icon?: string | null; // react-icons name
  icon_url?: string | null; // custom uploaded icon/logo
}

type ServicesPageContent = {
  heroImageUrl?: string;
  heroTitle?: string;
  introText?: string;
  sectionText?: string;
};

const DEFAULT_PAGE_CONTENT: ServicesPageContent = {
  heroImageUrl: "/sevices.avif",
  heroTitle: "Our Services",
  introText:
    "Explore our full range of services, expertly designed to meet both residential and commercial needs. From precision-crafted aluminum windows and doors to custom glass installations, our expertise spans design, fabrication, and installation. Discover how we can transform your space with top-tier craftsmanship and innovative solutions built for style, durability, and performance.",
  sectionText:
    "Explore our full range of services, expertly designed to meet both residential and commercial needs.",
};

const BUCKET_NAME = "uploads";

const ICON_OPTIONS = [
  { value: "FaHammer", label: "Heavy Duty 🛠️" },
  { value: "FaDoorOpen", label: "Sliding 🚪" },
  { value: "FaUmbrella", label: "Awning ☂️" },
  { value: "FaWindowRestore", label: "Casement 🪟" },
  { value: "FaWindowMaximize", label: "Top Hung 🪟" },
  { value: "FaObjectGroup", label: "Bi-folding 🗂️" },
  { value: "FaHome", label: "Facade 🏠" },
  { value: "FaStream", label: "Curtain Wall 🏢" },
  { value: "FaTent", label: "Canopy ⛺" },
  { value: "FaChartLine", label: "Glass Railings 📈" },
  { value: "FaShower", label: "Shower Enclosure 🚿" },
  { value: "FaLayerGroup", label: "Glass Partition 🧩" },
  { value: "FaCog", label: "Customized Design ⚙️" },
];

export default function AdminServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [newService, setNewService] = useState<Omit<Service, "id">>({
    name: "",
    short_description: "",
    long_description: "",
    icon: "FaHammer", // default to Heavy Duty
    icon_url: null,
  });
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [originalEditingService, setOriginalEditingService] = useState<Service | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploadingEditIcon, setUploadingEditIcon] = useState(false);
  const [uploadingHeroImage, setUploadingHeroImage] = useState(false);

  const [pageContent, setPageContent] = useState<ServicesPageContent>(DEFAULT_PAGE_CONTENT);
  const [savingPageContent, setSavingPageContent] = useState(false);

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
            details: `Admin ${admin.username} accessed Services management page`,
            page: 'Services',
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
      fetchServices();
      fetchPageContent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAdmin]);

  // ADD: page view activity
  useEffect(() => {
    if (currentAdmin) {
      autoLogActivity('view', 'page', `Accessed Services page`, {
        page: 'Services',
        metadata: { section: 'Services', timestamp: new Date().toISOString() }
      });
    }
  }, [currentAdmin]);

  const fetchServices = async () => {
    try {
      const { data, error } = await supabase.from("services").select("*").order("id");
      
      if (!error) {
        setServices(data || []);
        
        // Log successful data load
        if (currentAdmin) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: 'services',
            details: `Admin ${currentAdmin.username} loaded ${data?.length || 0} services`,
            page: 'Services',
            metadata: {
              servicesCount: data?.length || 0,
              adminAccount: currentAdmin.username,
              adminId: currentAdmin.id,
              timestamp: new Date().toISOString()
            }
          });
        }
      } else {
        console.error(error);
        
        // Log error
        if (currentAdmin) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: 'services_error',
            details: `Admin ${currentAdmin.username} failed to load services: ${error.message}`,
            page: 'Services',
            metadata: {
              error: error.message,
              adminAccount: currentAdmin.username,
              timestamp: new Date().toISOString()
            }
          });
        }
      }
    } catch (error) {
      console.error("Exception fetching services:", error);
    }
  };

  const getServicesPageApiUrl = () => {
    const siteBase = (process.env.NEXT_PUBLIC_WEBSITE_URL || "").replace(/\/$/, "");
    return siteBase ? `${siteBase}/api/services-page` : "/api/services-page";
  };

  const fetchPageContent = async () => {
    try {
      const apiUrl = getServicesPageApiUrl();
      const res = await fetch(apiUrl, { credentials: "include" });
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!res.ok) return;
      if (ct.includes("application/json")) {
        const d = await res.json();
        const loaded = (d?.content ?? d) as ServicesPageContent;
        const merged = { ...DEFAULT_PAGE_CONTENT, ...(loaded || {}) };
        setPageContent(merged);
      }
    } catch (e) {
      console.error("Failed to load services page content", e);
    }
  };

  const savePageContent = async () => {
    if (!currentAdmin) return;
    setSavingPageContent(true);
    try {
      const apiUrl = getServicesPageApiUrl();
      const res = await fetch(apiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pageContent),
        credentials: "include",
      });

      if (!res.ok) {
        const t = await res.text();
        console.error("Failed to save services page content:", res.status, t);
        return;
      }

      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "update",
        entity_type: "services_page_content",
        details: `Admin ${currentAdmin.username} updated Services page content`,
        page: "Services",
        metadata: {
          heroTitle: pageContent.heroTitle,
          heroImageUrl: pageContent.heroImageUrl,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (e) {
      console.error("Failed to save services page content", e);
    } finally {
      setSavingPageContent(false);
    }
  };

  const uploadToBucket = async (file: File) => {
    if (!currentAdmin) return null;
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const filePath = `${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      console.error("upload error:", uploadError);
      return null;
    }

    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
    return `${base}/storage/v1/object/public/${BUCKET_NAME}/${encodeURIComponent(filePath)}`;
  };

  const handleNewIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentAdmin) return;
    setUploadingIcon(true);
    try {
      const url = await uploadToBucket(file);
      if (url) setNewService((prev) => ({ ...prev, icon_url: url }));
    } finally {
      setUploadingIcon(false);
      if (e.target) e.target.value = "";
    }
  };

  const handleEditIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentAdmin || !editingService) return;
    setUploadingEditIcon(true);
    try {
      const url = await uploadToBucket(file);
      if (url) setEditingService((prev) => (prev ? { ...prev, icon_url: url } : prev));
    } finally {
      setUploadingEditIcon(false);
      if (e.target) e.target.value = "";
    }
  };

  const addService = async () => {
    if (!newService.name || !currentAdmin) {
      alert("Service name is required");
      return;
    }
    
    setLoading(true);
    
    try {
      const { data, error } = await supabase.from("services").insert([newService]).select();
      
      if (!error && data) {
        // Enhanced activity logging for service creation
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "service",
          entity_id: data[0].id.toString(),
          details: `Admin ${currentAdmin.username} created new service "${newService.name}"`,
          page: "Services",
          metadata: {
            serviceId: data[0].id,
            serviceName: newService.name,
            serviceIcon: newService.icon,
            shortDescription: newService.short_description,
            longDescription: newService.long_description,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });

        setNewService({
          name: "",
          short_description: "",
          long_description: "",
          icon: "FaHammer",
          icon_url: null,
        });
        setAddOpen(false);
        fetchServices();
      } else {
        console.error(error);
        
        // Log add error
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "service_error",
          details: `Admin ${currentAdmin.username} failed to create service "${newService.name}": ${error?.message}`,
          page: "Services",
          metadata: {
            serviceName: newService.name,
            error: error?.message,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      console.error("Exception adding service:", error);
    } finally {
      setLoading(false);
    }
  };

  const deleteService = async (id: number) => {
    if (!currentAdmin) return;

    const serviceToDelete = services.find(s => s.id === id);
    
    if (!confirm(`Are you sure you want to delete the service "${serviceToDelete?.name}"?`)) {
      // Log deletion cancelled
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'service_delete_cancelled',
        entity_id: id.toString(),
        details: `Admin ${currentAdmin.username} cancelled deletion of service "${serviceToDelete?.name}"`,
        page: 'Services',
        metadata: {
          serviceId: id,
          serviceName: serviceToDelete?.name,
          action: 'delete_cancelled',
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
      return;
    }

    try {
      const { error } = await supabase.from("services").delete().eq("id", id);
      
      if (!error) {
        // Enhanced activity logging for service deletion
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "delete",
          entity_type: "service",
          entity_id: id.toString(),
          details: `Admin ${currentAdmin.username} deleted service "${serviceToDelete?.name}"`,
          page: "Services",
          metadata: {
            serviceId: id,
            deletedService: {
              name: serviceToDelete?.name,
              icon: serviceToDelete?.icon,
              short_description: serviceToDelete?.short_description,
              long_description: serviceToDelete?.long_description
            },
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            remainingServicesCount: services.length - 1,
            timestamp: new Date().toISOString()
          }
        });

        fetchServices();
      } else {
        console.error(error);
      }
    } catch (error) {
      console.error("Exception deleting service:", error);
    }
  };

  const startEdit = async (service: Service) => {
    setEditingService(service);
    setOriginalEditingService(JSON.parse(JSON.stringify(service))); // Deep copy
    
    // Log edit initiation
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'service_edit_start',
        entity_id: service.id.toString(),
        details: `Admin ${currentAdmin.username} started editing service "${service.name}"`,
        page: 'Services',
        metadata: {
          serviceId: service.id,
          serviceName: service.name,
          action: 'edit_started',
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const saveEdit = async () => {
    if (!editingService || !originalEditingService || !currentAdmin) return;

    try {
      // Calculate changes for detailed logging
      const changes: Array<{field: string, oldValue: any, newValue: any}> = [];
      (['name', 'short_description', 'long_description', 'icon', 'icon_url'] as (keyof Service)[]).forEach((field) => {
        const oldVal = originalEditingService[field];
        const newVal = editingService[field];
        
        if (oldVal !== newVal) {
          changes.push({
            field: field,
            oldValue: oldVal,
            newValue: newVal
          });
        }
      });

      const { error } = await supabase
        .from("services")
        .update(editingService)
        .eq("id", editingService.id);

      if (!error) {
        // Enhanced activity logging for service update
        if (changes.length > 0) {
          const changesSummary = changes.map(c => `${c.field}: "${c.oldValue || ''}" → "${c.newValue || ''}"`);
          
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: "update",
            entity_type: "service",
            entity_id: editingService.id.toString(),
            details: `Admin ${currentAdmin.username} updated service "${originalEditingService.name}" with ${changes.length} changes: ${changesSummary.slice(0, 2).join("; ")}${changesSummary.length > 2 ? "..." : ""}`,
            page: "Services",
            metadata: {
              serviceId: editingService.id,
              originalName: originalEditingService.name,
              newName: editingService.name,
              adminAccount: currentAdmin.username,
              adminId: currentAdmin.id,
              changesCount: changes.length,
              changes: changesSummary,
              detailedChanges: changes,
              updateSummary: {
                nameChanged: changes.some(c => c.field === 'name'),
                shortDescriptionChanged: changes.some(c => c.field === 'short_description'),
                longDescriptionChanged: changes.some(c => c.field === 'long_description'),
                iconChanged: changes.some(c => c.field === 'icon')
                || changes.some(c => c.field === 'icon_url')
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
              entity_type: `service_${change.field}`,
              entity_id: editingService.id.toString(),
              details: `Admin ${currentAdmin.username} updated service ${change.field}: "${change.oldValue || ''}" → "${change.newValue || ''}"`,
              page: "Services",
              metadata: {
                serviceId: editingService.id,
                serviceName: originalEditingService.name,
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

        setEditingService(null);
        setOriginalEditingService(null);
        fetchServices();
      } else {
        console.error(error);
      }
    } catch (error) {
      console.error("Exception updating service:", error);
    }
  };

  const cancelEdit = async () => {
    if (currentAdmin && editingService) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'service_edit_cancelled',
        entity_id: editingService.id.toString(),
        details: `Admin ${currentAdmin.username} cancelled editing service "${editingService.name}"`,
        page: 'Services',
        metadata: {
          serviceId: editingService.id,
          serviceName: editingService.name,
          action: 'edit_cancelled',
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    setEditingService(null);
    setOriginalEditingService(null);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-extrabold text-black tracking-tight">
          ⚙️ Admin Services Manager
        </h1>
        <div className="text-sm text-gray-600">
          Editing as: {currentAdmin?.username || 'Unknown Admin'}
        </div>
      </div>

      {/* Services Page Content (Website) */}
      <div className="mb-10 bg-white border rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-xl font-semibold text-black">🧩 Services Page Content (Website)</h2>
          <button
            onClick={savePageContent}
            disabled={savingPageContent || !currentAdmin}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-md shadow transition-colors disabled:cursor-not-allowed"
          >
            {savingPageContent ? "Saving..." : "💾 Save Page Content"}
          </button>
        </div>

        <div className="grid gap-4 mt-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hero Title</label>
            <input
              type="text"
              value={pageContent.heroTitle || ""}
              onChange={(e) => setPageContent({ ...pageContent, heroTitle: e.target.value })}
              className="border p-2 rounded text-black w-full focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hero Image URL</label>
            <input
              type="text"
              value={pageContent.heroImageUrl || ""}
              readOnly
              className="border p-2 rounded text-black w-full focus:ring-2 focus:ring-blue-500"
            />
            <div className="mt-2 flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !currentAdmin) return;
                  setUploadingHeroImage(true);
                  const url = await uploadToBucket(file);
                  if (url) setPageContent((prev) => ({ ...prev, heroImageUrl: url }));
                  setUploadingHeroImage(false);
                  if (e.target) e.target.value = "";
                }}
                className="text-sm"
              />
              <button
                type="button"
                onClick={() => setPageContent((prev) => ({ ...prev, heroImageUrl: "" }))}
                className="px-3 py-1 rounded border text-sm text-gray-700 hover:bg-gray-50"
              >
                Clear
              </button>
              {uploadingHeroImage ? <span className="text-xs text-blue-600">Uploading...</span> : null}
              {pageContent.heroImageUrl ? (
                <img
                  src={pageContent.heroImageUrl}
                  alt="Hero preview"
                  className="w-16 h-10 object-cover rounded border"
                />
              ) : null}
            </div>
            <p className="text-xs text-gray-500 mt-1">Uploads go to Supabase Storage bucket "{BUCKET_NAME}".</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Intro Text</label>
          <textarea
            value={pageContent.introText || ""}
            onChange={(e) => setPageContent({ ...pageContent, introText: e.target.value })}
            className="border p-2 rounded text-black w-full focus:ring-2 focus:ring-blue-500"
            rows={4}
          />
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Section Text (above cards)</label>
          <textarea
            value={pageContent.sectionText || ""}
            onChange={(e) => setPageContent({ ...pageContent, sectionText: e.target.value })}
            className="border p-2 rounded text-black w-full focus:ring-2 focus:ring-blue-500"
            rows={2}
          />
        </div>
      </div>

      {/* Add New Service Button */}
      <div className="mb-6 flex justify-end">
        <button
          onClick={() => setAddOpen(true)}
          className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-md shadow transition-colors"
        >
          ➕ Add New Service
        </button>
      </div>

      {/* Services Table */}
      <div className="overflow-x-auto bg-white rounded-lg shadow-md">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-100 text-black">
              <th className="p-3">ID</th>
              <th className="p-3">Icon</th>
              <th className="p-3">Name</th>
              <th className="p-3">Short Description</th>
              <th className="p-3">Long Description</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => {
              const IconComponent =
                s.icon && (FaIcons as any)[s.icon]
                  ? (FaIcons as any)[s.icon]
                  : FaIcons.FaCog;
              return (
                <tr key={s.id} className="border-t hover:bg-gray-50 transition-colors">
                  <td className="p-3 text-black font-medium">{s.id}</td>
                  <td className="p-3 text-center">
                    {s.icon_url ? (
                      <img
                        src={s.icon_url}
                        alt={s.name}
                        className="w-10 h-10 object-contain mx-auto"
                      />
                    ) : (
                      <IconComponent size={32} className="text-blue-600 mx-auto" />
                    )}
                  </td>
                  <td className="p-3 font-semibold text-black">{s.name}</td>
                  <td className="p-3 text-black max-w-xs truncate">{s.short_description}</td>
                  <td className="p-3 truncate max-w-sm text-black">{s.long_description}</td>
                  <td className="p-3 space-x-2 text-black">
                    <button
                      onClick={() => startEdit(s)}
                      className="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700 transition-colors"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => deleteService(s.id)}
                      className="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700 transition-colors"
                    >
                      🗑️ Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {services.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">⚙️</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No services yet</h3>
            <p className="text-gray-500">Create your first service to get started!</p>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {addOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4 text-black">➕ Add New Service</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service Name</label>
                <input
                  type="text"
                  value={newService.name}
                  onChange={(e) => setNewService({ ...newService, name: e.target.value })}
                  className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Built-in Icon (optional)</label>
                  <select
                    value={newService.icon || ""}
                    onChange={(e) => setNewService({ ...newService, icon: e.target.value })}
                    className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-blue-500"
                  >
                    {ICON_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">If a custom icon/logo is set, it will be used instead.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Custom Icon/Logo URL (optional)</label>
                  <input
                    type="text"
                    value={newService.icon_url || ""}
                    onChange={(e) => setNewService({ ...newService, icon_url: e.target.value })}
                    className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleNewIconUpload}
                      className="text-sm"
                    />
                    {uploadingIcon ? (
                      <span className="text-xs text-gray-600">Uploading...</span>
                    ) : null}
                    {newService.icon_url ? (
                      <img
                        src={newService.icon_url}
                        alt="Icon preview"
                        className="w-10 h-10 object-contain rounded border"
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Short Description</label>
                <textarea
                  value={newService.short_description}
                  onChange={(e) => setNewService({ ...newService, short_description: e.target.value })}
                  className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-blue-500"
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Long Description (details page)</label>
                <textarea
                  value={newService.long_description}
                  onChange={(e) => setNewService({ ...newService, long_description: e.target.value })}
                  className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-blue-500"
                  rows={6}
                />
                <p className="text-xs text-gray-500 mt-1">The website “Learn More” page renders this content (new lines become paragraphs).</p>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setAddOpen(false)}
                className="bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addService}
                disabled={loading || !newService.name}
                className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white px-4 py-2 rounded transition-colors disabled:cursor-not-allowed"
              >
                {loading ? "Adding..." : "Add Service"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingService && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4 text-black">✏️ Edit Service</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service Name</label>
                <input
                  type="text"
                  value={editingService.name}
                  onChange={(e) =>
                    setEditingService({ ...editingService, name: e.target.value })
                  }
                  className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Icon</label>
                <select
                  value={editingService.icon || ""}
                  onChange={(e) =>
                    setEditingService({ ...editingService, icon: e.target.value })
                  }
                  className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-blue-500"
                >
                  {ICON_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">If a custom icon/logo is set below, it will be used on the website instead.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Custom Icon/Logo URL (optional)</label>
                <input
                  type="text"
                  value={editingService.icon_url || ""}
                  onChange={(e) => setEditingService({ ...editingService, icon_url: e.target.value })}
                  className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-blue-500"
                />
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleEditIconUpload}
                    className="text-sm"
                  />
                  {uploadingEditIcon ? (
                    <span className="text-xs text-gray-600">Uploading...</span>
                  ) : null}
                  {editingService.icon_url ? (
                    <img
                      src={editingService.icon_url}
                      alt="Icon preview"
                      className="w-10 h-10 object-contain rounded border"
                    />
                  ) : null}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Short Description</label>
                <textarea
                  value={editingService.short_description}
                  onChange={(e) =>
                    setEditingService({
                      ...editingService,
                      short_description: e.target.value,
                    })
                  }
                  className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-blue-500"
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Long Description</label>
                <textarea
                  value={editingService.long_description}
                  onChange={(e) =>
                    setEditingService({
                      ...editingService,
                      long_description: e.target.value,
                    })
                  }
                  className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-blue-500"
                  rows={4}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={cancelEdit}
                className="bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
