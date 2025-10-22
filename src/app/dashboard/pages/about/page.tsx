"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Edit3 } from "lucide-react";
import { logActivity } from "@/app/lib/activity";

interface About {
  id: number;
  grand: string;
  description: string;
  mission: string;
  vision: string;
}

export default function AdminAboutPage() {
  const [about, setAbout] = useState<About | null>(null);
  const [originalAbout, setOriginalAbout] = useState<About | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<Partial<About>>({});
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);

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
            details: `Admin ${admin.username} accessed About page management`,
            page: 'About',
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
    // Removed fetchAbout() here so we fetch after admin is set
  }, []);

  // Fetch after admin is available so logs include admin info
  useEffect(() => {
    if (currentAdmin) {
      fetchAbout();
    }
  }, [currentAdmin]);

  const fetchAbout = async () => {
    try {
      const { data, error } = await supabase.from("about").select("*").single();
      if (!error && data) {
        setAbout(data);
        setOriginalAbout(JSON.parse(JSON.stringify(data))); // Deep copy for comparison
        setForm(data);

        // Log successful data load
        if (currentAdmin) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: 'about_content',
            entity_id: data.id.toString(),
            details: `Admin ${currentAdmin.username} loaded About page content for editing`,
            page: 'About',
            metadata: {
              aboutId: data.id,
              contentSections: ['grand', 'description', 'mission', 'vision'],
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
            entity_type: 'about_error',
            details: `Admin ${currentAdmin.username} failed to load About page content: ${error?.message || 'Unknown error'}`,
            page: 'About',
            metadata: {
              error: error?.message,
              adminAccount: currentAdmin.username,
              timestamp: new Date().toISOString()
            }
          });
        }
      }
    } catch (error) {
      console.error("Error fetching about:", error);
    }
  };

  // Enhanced form change handler with real-time logging
  const handleFormChange = async (field: keyof About, value: string) => {
    const oldValue = form[field];
    setForm({ ...form, [field]: value });

    // Log individual field changes for detailed tracking
    if (currentAdmin && oldValue !== value && originalAbout) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'update',
        entity_type: 'about_field',
        entity_id: about?.id.toString() || 'unknown',
        details: `Admin ${currentAdmin.username} changed About ${field} from "${String(oldValue ?? '')}" to "${String(value ?? '')}"`,
        page: 'About',
        metadata: {
          fieldChanged: field,
          oldValue: oldValue,
          newValue: value,
          aboutId: about?.id,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const handleEdit = async () => {
    setEditing(true);
    
    // Log edit mode initiation
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'about_edit_mode',
        entity_id: about?.id.toString() || 'unknown',
        details: `Admin ${currentAdmin.username} started editing About page content`,
        page: 'About',
        metadata: {
          action: 'edit_mode_started',
          aboutId: about?.id,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const handleCancel = async () => {
    setEditing(false);
    setForm(about || {});
    
    // Log edit cancellation
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'about_edit_cancelled',
        entity_id: about?.id.toString() || 'unknown',
        details: `Admin ${currentAdmin.username} cancelled editing About page content`,
        page: 'About',
        metadata: {
          action: 'edit_cancelled',
          aboutId: about?.id,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const handleSave = async () => {
    if (!about || !currentAdmin) return;
    
    setLoading(true);

    try {
      // Calculate detailed changes for comprehensive logging
      const changes: Array<{field: string, oldValue: any, newValue: any}> = [];
      const changesSummary: string[] = [];
      
      (['grand', 'description', 'mission', 'vision'] as (keyof About)[]).forEach((field) => {
        const oldVal = originalAbout?.[field];
        const newVal = form[field];
        
        if (oldVal !== newVal) {
          changes.push({
            field: field,
            oldValue: oldVal,
            newValue: newVal
          });
          changesSummary.push(`${field}: "${String(oldVal ?? "")}" → "${String(newVal ?? "")}"`);
        }
      });

      const { error } = await supabase
        .from("about")
        .update({
          grand: form.grand,
          description: form.description,
          mission: form.mission,
          vision: form.vision,
          updated_at: new Date(),
        })
        .eq("id", about.id);

      setLoading(false);

      if (!error) {
        setEditing(false);
        
        // Enhanced comprehensive activity logging for successful update
        if (changes.length > 0) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: "update",
            entity_type: "about_content",
            entity_id: about.id.toString(),
            page: "About",
            details: `Admin ${currentAdmin.username} updated About page with ${changes.length} changes: ${changesSummary.slice(0, 2).join("; ")}${changesSummary.length > 2 ? "..." : ""}`,
            metadata: {
              aboutId: about.id,
              adminAccount: currentAdmin.username,
              adminId: currentAdmin.id,
              changesCount: changes.length,
              changes: changesSummary,
              detailedChanges: changes,
              updatedAt: new Date().toISOString(),
              fieldsUpdated: changes.map(c => c.field),
              updateSummary: {
                grandChanged: changes.some(c => c.field === 'grand'),
                descriptionChanged: changes.some(c => c.field === 'description'),
                missionChanged: changes.some(c => c.field === 'mission'),
                visionChanged: changes.some(c => c.field === 'vision')
              }
            }
          });

          // Log specific important changes separately for better tracking
          for (const change of changes) {
            await logActivity({
              admin_id: currentAdmin.id,
              admin_name: currentAdmin.username,
              action: "update",
              entity_type: `about_${change.field}`,
              entity_id: about.id.toString(),
              page: "About",
              details: `Admin ${currentAdmin.username} updated About ${change.field}: "${String(change.oldValue ?? '')}" → "${String(change.newValue ?? '')}"`,
              metadata: {
                fieldName: change.field,
                oldValue: change.oldValue,
                newValue: change.newValue,
                aboutId: about.id,
                adminAccount: currentAdmin.username,
                adminId: currentAdmin.id,
                timestamp: new Date().toISOString()
              }
            });
          }
        } else {
          // Log save with no changes
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: "view",
            entity_type: "about_no_changes",
            entity_id: about.id.toString(),
            page: "About",
            details: `Admin ${currentAdmin.username} saved About page with no changes made`,
            metadata: {
              aboutId: about.id,
              adminAccount: currentAdmin.username,
              adminId: currentAdmin.id,
              timestamp: new Date().toISOString()
            }
          });
        }

        await fetchAbout();
      } else {
        console.error(error);
        
        // Log save error
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "update",
          entity_type: "about_error",
          entity_id: about.id.toString(),
          page: "About",
          details: `Admin ${currentAdmin.username} failed to update About page: ${error.message}`,
          metadata: {
            aboutId: about.id,
            error: error.message,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            attemptedChanges: changes.length,
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      setLoading(false);
      console.error("Error saving about:", error);
      
      // Log save exception
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "update",
          entity_type: "about_exception",
          entity_id: about?.id.toString() || 'unknown',
          page: "About",
          details: `Admin ${currentAdmin.username} encountered error updating About page: ${error}`,
          metadata: {
            aboutId: about?.id,
            error: String(error),
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  };

  if (!about) {
    return <p className="text-center mt-10 text-black">Loading...</p>;
  }

  return (
    <div className="p-8 min-h-screen bg-gray-50">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-black">Admin – About Page</h1>
        <div className="text-sm text-gray-600">
          Editing as: {currentAdmin?.username || 'Unknown Admin'}
        </div>
      </div>

      <Card className="shadow-lg rounded-2xl border border-gray-900 bg-white">
        <CardContent className="p-6 space-y-6">
          {!editing ? (
            <>
              <div>
                <h2 className="text-xl font-semibold text-black mb-2">Grand</h2>
                <p className="text-black">{about.grand}</p>
              </div>

              <div>
                <h2 className="text-xl font-semibold text-black mb-2">Description</h2>
                <p className="text-black">{about.description}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h2 className="text-xl font-semibold text-black mb-2">Mission</h2>
                  <p className="text-black">{about.mission}</p>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-black mb-2">Vision</h2>
                  <p className="text-black">{about.vision}</p>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-black mb-1">Grand Title</label>
                <Input
                  placeholder="Grand Title"
                  value={form.grand || ""}
                  onChange={(e) => handleFormChange('grand', e.target.value)}
                  className="text-black placeholder:text-gray-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-black mb-1">Description</label>
                <Textarea
                  placeholder="Description"
                  rows={3}
                  value={form.description || ""}
                  onChange={(e) => handleFormChange('description', e.target.value)}
                  className="text-black placeholder:text-gray-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-black mb-1">Mission</label>
                <Textarea
                  placeholder="Mission"
                  rows={3}
                  value={form.mission || ""}
                  onChange={(e) => handleFormChange('mission', e.target.value)}
                  className="text-black placeholder:text-gray-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-black mb-1">Vision</label>
                <Textarea
                  placeholder="Vision"
                  rows={3}
                  value={form.vision || ""}
                  onChange={(e) => handleFormChange('vision', e.target.value)}
                  className="text-black placeholder:text-gray-500"
                />
              </div>
            </div>
          )}

          <div className="flex gap-3">
            {!editing && (
              <Button
                onClick={handleEdit}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Edit3 size={18} /> Edit
              </Button>
            )}
            {editing && (
              <>
                <Button
                  onClick={handleSave}
                  disabled={loading}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {loading ? <Loader2 className="animate-spin h-5 w-5" /> : "Save Changes"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}