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
  icon?: string; // new field
}

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
  });
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [originalEditingService, setOriginalEditingService] = useState<Service | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [loading, setLoading] = useState(false);

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
    }
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
        });
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
      (['name', 'short_description', 'long_description', 'icon'] as (keyof Service)[]).forEach((field) => {
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

      {/* Add New Service Form */}
      <div className="mb-10 bg-white border rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4 text-black">
          ➕ Add New Service
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            type="text"
            placeholder="Service Name"
            value={newService.name}
            onChange={(e) => setNewService({ ...newService, name: e.target.value })}
            className="border p-2 rounded text-black w-full focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={newService.icon || ""}
            onChange={(e) => setNewService({ ...newService, icon: e.target.value })}
            className="border p-2 rounded text-black w-full focus:ring-2 focus:ring-blue-500"
          >
            {ICON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <textarea
          placeholder="Short Description"
          value={newService.short_description}
          onChange={(e) =>
            setNewService({ ...newService, short_description: e.target.value })
          }
          className="border p-2 rounded text-black w-full mt-3 focus:ring-2 focus:ring-blue-500"
          rows={2}
        />
        <textarea
          placeholder="Long Description"
          value={newService.long_description}
          onChange={(e) =>
            setNewService({ ...newService, long_description: e.target.value })
          }
          className="border p-2 rounded text-black w-full mt-3 focus:ring-2 focus:ring-blue-500"
          rows={4}
        />
        <button
          onClick={addService}
          disabled={loading || !newService.name}
          className="mt-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white px-5 py-2 rounded-md shadow transition-colors disabled:cursor-not-allowed"
        >
          {loading ? "Adding..." : "➕ Add Service"}
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
                    <IconComponent size={32} className="text-blue-600 mx-auto" />
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
