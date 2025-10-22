"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { Plus, Edit3, Trash2, ExternalLink, Image as ImageIcon, Upload } from "lucide-react";
import { logActivity } from "@/app/lib/activity";

interface Project {
  id: number;
  title: string;
  description: string;
  image_url?: string;
  link_url?: string;
  created_at?: string;
}

export default function AdminFeaturedProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProject, setNewProject] = useState<Omit<Project, "id">>({
    title: "",
    description: "",
    image_url: "",
    link_url: "",
  });
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [originalEditingProject, setOriginalEditingProject] = useState<Project | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

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
            details: `Admin ${admin.username} accessed Featured Projects management page`,
            page: 'Featured',
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
      fetchProjects();
    }
  }, [currentAdmin]);

  const fetchProjects = async () => {
    try {
      const { data, error } = await supabase
        .from("featured_projects")
        .select("*")
        .order("id", { ascending: true });
      
      if (!error) {
        setProjects(data || []);
        
        // Log successful data load
        if (currentAdmin) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: 'featured_projects',
            details: `Admin ${currentAdmin.username} loaded ${data?.length || 0} featured projects`,
            page: 'Featured',
            metadata: {
              projectsCount: data?.length || 0,
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
            entity_type: 'featured_projects_error',
            details: `Admin ${currentAdmin.username} failed to load featured projects: ${error.message}`,
            page: 'Featured',
            metadata: {
              error: error.message,
              adminAccount: currentAdmin.username,
              timestamp: new Date().toISOString()
            }
          });
        }
      }
    } catch (error) {
      console.error("Exception fetching projects:", error);
    }
  };

  const handleAddModalOpen = async () => {
    setShowAddModal(true);
    
    // Log add modal opening
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'featured_project_add_modal',
        details: `Admin ${currentAdmin.username} opened add new featured project modal`,
        page: 'Featured',
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
    setShowAddModal(false);
    setNewProject({ title: "", description: "", image_url: "", link_url: "" });
    
    // Log add modal closing
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'featured_project_add_cancelled',
        details: `Admin ${currentAdmin.username} cancelled adding new featured project`,
        page: 'Featured',
        metadata: {
          action: 'add_cancelled',
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const addProject = async () => {
    if (!newProject.title || !currentAdmin) {
      alert("Title is required");
      return;
    }
    
    setLoading(true);
    
    try {
      const { data, error } = await supabase
        .from("featured_projects")
        .insert([newProject])
        .select();
      
      if (!error && data) {
        // Enhanced activity logging for project creation
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "featured_project",
          entity_id: data[0].id.toString(),
          details: `Admin ${currentAdmin.username} created new featured project "${newProject.title}"`,
          page: "Featured",
          metadata: {
            projectId: data[0].id,
            projectTitle: newProject.title,
            projectDescription: newProject.description,
            hasImage: !!newProject.image_url,
            hasLink: !!newProject.link_url,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });

        setNewProject({ title: "", description: "", image_url: "", link_url: "" });
        setShowAddModal(false);
        fetchProjects();
      } else {
        console.error(error);
        
        // Log add error
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "featured_project_error",
          details: `Admin ${currentAdmin.username} failed to create featured project "${newProject.title}": ${error?.message}`,
          page: "Featured",
          metadata: {
            projectTitle: newProject.title,
            error: error?.message,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      console.error("Exception adding project:", error);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = async (project: Project) => {
    setEditingProject(project);
    setOriginalEditingProject(JSON.parse(JSON.stringify(project))); // Deep copy
    
    // Log edit initiation
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'featured_project_edit_start',
        entity_id: project.id.toString(),
        details: `Admin ${currentAdmin.username} started editing featured project "${project.title}"`,
        page: 'Featured',
        metadata: {
          projectId: project.id,
          projectTitle: project.title,
          action: 'edit_started',
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const saveEdit = async () => {
    if (!editingProject || !originalEditingProject || !currentAdmin) return;

    try {
      // Calculate changes for detailed logging
      const changes: Array<{field: string, oldValue: any, newValue: any}> = [];
      (['title', 'description', 'image_url', 'link_url'] as (keyof Project)[]).forEach((field) => {
        const oldVal = originalEditingProject[field];
        const newVal = editingProject[field];
        
        if (oldVal !== newVal) {
          changes.push({
            field: field,
            oldValue: oldVal,
            newValue: newVal
          });
        }
      });

      const { error } = await supabase
        .from("featured_projects")
        .update({
          title: editingProject.title,
          description: editingProject.description,
          image_url: editingProject.image_url,
          link_url: editingProject.link_url,
        })
        .eq("id", editingProject.id);

      if (!error) {
        // Enhanced activity logging for project update
        if (changes.length > 0) {
          const changesSummary = changes.map(c => `${c.field}: "${c.oldValue || ''}" → "${c.newValue || ''}"`);
          
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: "update",
            entity_type: "featured_project",
            entity_id: editingProject.id.toString(),
            details: `Admin ${currentAdmin.username} updated featured project "${originalEditingProject.title}" with ${changes.length} changes: ${changesSummary.slice(0, 2).join("; ")}${changesSummary.length > 2 ? "..." : ""}`,
            page: "Featured",
            metadata: {
              projectId: editingProject.id,
              originalTitle: originalEditingProject.title,
              newTitle: editingProject.title,
              adminAccount: currentAdmin.username,
              adminId: currentAdmin.id,
              changesCount: changes.length,
              changes: changesSummary,
              detailedChanges: changes,
              updateSummary: {
                titleChanged: changes.some(c => c.field === 'title'),
                descriptionChanged: changes.some(c => c.field === 'description'),
                imageChanged: changes.some(c => c.field === 'image_url'),
                linkChanged: changes.some(c => c.field === 'link_url')
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
              entity_type: `featured_project_${change.field}`,
              entity_id: editingProject.id.toString(),
              details: `Admin ${currentAdmin.username} updated featured project ${change.field}: "${change.oldValue || ''}" → "${change.newValue || ''}"`,
              page: "Featured",
              metadata: {
                projectId: editingProject.id,
                projectTitle: originalEditingProject.title,
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

        setEditingProject(null);
        setOriginalEditingProject(null);
        fetchProjects();
      } else {
        console.error(error);
      }
    } catch (error) {
      console.error("Exception updating project:", error);
    }
  };

  const cancelEdit = async () => {
    if (currentAdmin && editingProject) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'featured_project_edit_cancelled',
        entity_id: editingProject.id.toString(),
        details: `Admin ${currentAdmin.username} cancelled editing featured project "${editingProject.title}"`,
        page: 'Featured',
        metadata: {
          projectId: editingProject.id,
          projectTitle: editingProject.title,
          action: 'edit_cancelled',
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    setEditingProject(null);
    setOriginalEditingProject(null);
  };

  const deleteProject = async (id: number) => {
    if (!currentAdmin) return;

    const projectToDelete = projects.find(p => p.id === id);
    
    if (!confirm(`Are you sure you want to delete the project "${projectToDelete?.title}"?`)) {
      // Log deletion cancelled
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'featured_project_delete_cancelled',
        entity_id: id.toString(),
        details: `Admin ${currentAdmin.username} cancelled deletion of featured project "${projectToDelete?.title}"`,
        page: 'Featured',
        metadata: {
          projectId: id,
          projectTitle: projectToDelete?.title,
          action: 'delete_cancelled',
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("featured_projects")
        .delete()
        .eq("id", id);
      
      if (!error) {
        // Enhanced activity logging for project deletion
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "delete",
          entity_type: "featured_project",
          entity_id: id.toString(),
          details: `Admin ${currentAdmin.username} deleted featured project "${projectToDelete?.title}"`,
          page: "Featured",
          metadata: {
            projectId: id,
            deletedProject: {
              title: projectToDelete?.title,
              description: projectToDelete?.description,
              image_url: projectToDelete?.image_url,
              link_url: projectToDelete?.link_url
            },
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            remainingProjectsCount: projects.length - 1,
            timestamp: new Date().toISOString()
          }
        });

        fetchProjects();
      } else {
        console.error(error);
      }
    } catch (error) {
      console.error("Exception deleting project:", error);
    }
  };

  // Handle image upload for new project
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, isEdit = false) => {
    const file = e.target.files?.[0];
    if (!file || !currentAdmin) return;
    
    setUploading(true);
    
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Date.now()}-${Math.random()
        .toString(36)
        .substring(2)}.${fileExt}`;
      
      const { data, error } = await supabase.storage
        .from("featured-projects-images")
        .upload(fileName, file);

      if (error) {
        alert("Image upload failed.");
        
        // Log upload error
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "upload",
          entity_type: "featured_project_image_error",
          details: `Admin ${currentAdmin.username} failed to upload image for featured project: ${error.message}`,
          page: "Featured",
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

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("featured-projects-images")
        .getPublicUrl(data.path);

      const url = urlData?.publicUrl || "";
      
      if (isEdit && editingProject) {
        setEditingProject({ ...editingProject, image_url: url });
      } else {
        setNewProject({ ...newProject, image_url: url });
      }

      // Log successful image upload
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "upload",
        entity_type: "featured_project_image",
        details: `Admin ${currentAdmin.username} uploaded image for featured project: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
        page: "Featured",
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          fileSizeMB: (file.size / 1024 / 1024).toFixed(2),
          fileType: file.type,
          uploadPath: data.path,
          imageUrl: url,
          isEditMode: isEdit,
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

  return (
    <div className="p-6 max-w-7xl mx-auto bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Featured Projects</h1>
          <p className="text-gray-600 mt-1">Manage your featured projects showcase</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-600">
            Editing as: {currentAdmin?.username || 'Unknown Admin'}
          </div>
          <button
            onClick={handleAddModalOpen}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg shadow-sm transition-colors"
          >
            <Plus size={20} />
            Add Project
          </button>
        </div>
      </div>

      {/* Projects Grid */}
      {projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <div key={project.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
              {/* Project Image */}
              <div className="relative h-48 bg-gray-100">
                {project.image_url ? (
                  <img
                    src={project.image_url}
                    alt={project.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    <ImageIcon size={48} />
                  </div>
                )}
                <div className="absolute top-2 right-2">
                  <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2 py-1 rounded-full">
                    ID: {project.id}
                  </span>
                </div>
              </div>

              {/* Project Content */}
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">
                  {project.title}
                </h3>
                <p className="text-gray-600 text-sm mb-4 line-clamp-3">
                  {project.description || 'No description provided'}
                </p>
                
                {/* Link */}
                {project.link_url && (
                  <div className="mb-4">
                    <a
                      href={project.link_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      <ExternalLink size={14} />
                      View Project
                    </a>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                  <div className="text-xs text-gray-500">
                    {project.created_at ? new Date(project.created_at).toLocaleDateString() : 'Unknown date'}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEdit(project)}
                      className="flex items-center gap-1 px-3 py-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors text-sm font-medium"
                    >
                      <Edit3 size={14} />
                      Edit
                    </button>
                    <button
                      onClick={() => deleteProject(project.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md transition-colors text-sm font-medium"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-white rounded-xl border-2 border-dashed border-gray-300">
          <div className="text-6xl mb-4">🎨</div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No featured projects yet</h3>
          <p className="text-gray-500 mb-6">Create your first featured project to showcase your work!</p>
          <button
            onClick={handleAddModalOpen}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg shadow-sm transition-colors"
          >
            <Plus size={20} />
            Add Your First Project
          </button>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Add New Featured Project</h2>
            </div>
            
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Project Title *</label>
                <input
                  type="text"
                  placeholder="Enter project title..."
                  value={newProject.title}
                  onChange={(e) => setNewProject({ ...newProject, title: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  placeholder="Enter project description..."
                  rows={4}
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Project Image</label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleImageUpload(e, false)}
                    disabled={uploading}
                    className="w-full"
                  />
                  {uploading && (
                    <div className="mt-2 text-blue-600 text-sm">
                      <Upload className="inline mr-1" size={16} />
                      Uploading...
                    </div>
                  )}
                  {newProject.image_url && (
                    <div className="mt-4">
                      <img
                        src={newProject.image_url}
                        alt="Preview"
                        className="h-32 w-full object-cover rounded-lg"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Project Link</label>
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={newProject.link_url}
                  onChange={(e) => setNewProject({ ...newProject, link_url: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
              <button
                onClick={handleAddModalClose}
                className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addProject}
                disabled={loading || !newProject.title}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors disabled:cursor-not-allowed"
              >
                {loading ? "Adding..." : "Add Project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Edit Featured Project</h2>
            </div>
            
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Project Title *</label>
                <input
                  type="text"
                  value={editingProject.title}
                  onChange={(e) => setEditingProject({ ...editingProject, title: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  rows={4}
                  value={editingProject.description}
                  onChange={(e) => setEditingProject({ ...editingProject, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Project Image</label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                  {editingProject.image_url && (
                    <div className="mb-4">
                      <img
                        src={editingProject.image_url}
                        alt="Current"
                        className="h-32 w-full object-cover rounded-lg"
                      />
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleImageUpload(e, true)}
                    disabled={uploading}
                    className="w-full"
                  />
                  {uploading && (
                    <div className="mt-2 text-blue-600 text-sm">
                      <Upload className="inline mr-1" size={16} />
                      Uploading...
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Project Link</label>
                <input
                  type="url"
                  value={editingProject.link_url}
                  onChange={(e) => setEditingProject({ ...editingProject, link_url: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
              <button
                onClick={cancelEdit}
                className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
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
