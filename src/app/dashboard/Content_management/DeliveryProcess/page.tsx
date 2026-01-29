'use client';

import { useEffect, useState } from 'react';
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { logActivity } from "@/app/lib/activity";

type Warranty = {
  id: number;
  title: string;
  description: string;
};

export default function AdminDeliveryProcess() {
  const [steps, setSteps] = useState<Warranty[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [editingStep, setEditingStep] = useState<Warranty | null>(null);
  const [originalEditingStep, setOriginalEditingStep] = useState<Warranty | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
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
            details: `Admin ${admin.username} accessed Delivery Process management page`,
            page: 'DeliveryProcess',
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
      fetchSteps();
    }
  }, [currentAdmin]);

  const fetchSteps = async () => {
    try {
      const { data, error } = await supabase
        .from('warranties')
        .select('*')
        .order('id', { ascending: true });
      
      if (!error) {
        setSteps(data || []);
        
        // Log successful data load
        if (currentAdmin) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: 'delivery_steps',
            details: `Admin ${currentAdmin.username} loaded ${data?.length || 0} delivery process steps`,
            page: 'DeliveryProcess',
            metadata: {
              stepsCount: data?.length || 0,
              adminAccount: currentAdmin.username,
              adminId: currentAdmin.id,
              timestamp: new Date().toISOString()
            }
          });
        }
      } else {
        console.error("Error fetching steps:", error);
        
        // Log error
        if (currentAdmin) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: 'delivery_steps_error',
            details: `Admin ${currentAdmin.username} failed to load delivery process steps: ${error.message}`,
            page: 'DeliveryProcess',
            metadata: {
              error: error.message,
              adminAccount: currentAdmin.username,
              timestamp: new Date().toISOString()
            }
          });
        }
      }
    } catch (error) {
      console.error("Exception fetching steps:", error);
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
        entity_type: 'delivery_add_modal',
        details: `Admin ${currentAdmin.username} opened add new delivery step modal`,
        page: 'DeliveryProcess',
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
    setTitle('');
    setDescription('');
    
    // Log add modal closing
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'delivery_add_cancelled',
        details: `Admin ${currentAdmin.username} cancelled adding new delivery step`,
        page: 'DeliveryProcess',
        metadata: {
          action: 'add_cancelled',
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const addStep = async () => {
    if (!title || !description || !currentAdmin) return;

    try {
      const { data, error } = await supabase
        .from('warranties')
        .insert([{ title, description }])
        .select();
      
      if (!error && data) {
        // Enhanced activity logging for step creation
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "delivery_step",
          entity_id: data[0].id.toString(),
          page: "DeliveryProcess",
          details: `Admin ${currentAdmin.username} created new delivery step "${title}"`,
          metadata: {
            stepId: data[0].id,
            stepTitle: title,
            stepDescription: description,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            stepNumber: steps.length + 1,
            timestamp: new Date().toISOString()
          }
        });

        setTitle('');
        setDescription('');
        setShowAddModal(false);
        fetchSteps();
      } else {
        console.error("Error adding step:", error);
        
        // Log add error
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "delivery_step_error",
          details: `Admin ${currentAdmin.username} failed to create delivery step "${title}": ${error?.message}`,
          page: "DeliveryProcess",
          metadata: {
            stepTitle: title,
            stepDescription: description,
            error: error?.message,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      console.error("Exception adding step:", error);
      
      // Log add exception
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "delivery_step_exception",
          details: `Admin ${currentAdmin.username} encountered error creating delivery step: ${error}`,
          page: "DeliveryProcess",
          metadata: {
            stepTitle: title,
            error: String(error),
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  };

  const deleteStep = async (id: number) => {
    if (!currentAdmin) return;

    const stepToDelete = steps.find(s => s.id === id);
    
    if (!confirm(`Are you sure you want to delete the step "${stepToDelete?.title}"?`)) {
      // Log deletion cancelled
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'delivery_delete_cancelled',
        entity_id: id.toString(),
        details: `Admin ${currentAdmin.username} cancelled deletion of delivery step "${stepToDelete?.title}"`,
        page: 'DeliveryProcess',
        metadata: {
          stepId: id,
          stepTitle: stepToDelete?.title,
          action: 'delete_cancelled',
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
      return;
    }

    try {
      const { error } = await supabase.from('warranties').delete().eq('id', id);
      
      if (!error) {
        // Enhanced activity logging for step deletion
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "delete",
          entity_type: "delivery_step",
          entity_id: id.toString(),
          page: "DeliveryProcess",
          details: `Admin ${currentAdmin.username} deleted delivery step "${stepToDelete?.title}"`,
          metadata: {
            stepId: id,
            deletedStep: {
              title: stepToDelete?.title,
              description: stepToDelete?.description
            },
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            remainingStepsCount: steps.length - 1,
            timestamp: new Date().toISOString()
          }
        });

        fetchSteps();
      } else {
        console.error("Error deleting step:", error);
        
        // Log delete error
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "delete",
          entity_type: "delivery_step_error",
          entity_id: id.toString(),
          details: `Admin ${currentAdmin.username} failed to delete delivery step "${stepToDelete?.title}": ${error.message}`,
          page: "DeliveryProcess",
          metadata: {
            stepId: id,
            stepTitle: stepToDelete?.title,
            error: error.message,
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      console.error("Exception deleting step:", error);
      
      // Log delete exception
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "delete",
          entity_type: "delivery_step_exception",
          entity_id: id.toString(),
          details: `Admin ${currentAdmin.username} encountered error deleting delivery step: ${error}`,
          page: "DeliveryProcess",
          metadata: {
            stepId: id,
            error: String(error),
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  };

  const startEdit = async (step: Warranty) => {
    setEditingStep(step);
    setOriginalEditingStep(JSON.parse(JSON.stringify(step))); // Deep copy for comparison
    setTitle(step.title);
    setDescription(step.description);
    setShowEditModal(true);
    
    // Log edit modal opening
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'delivery_edit_modal',
        entity_id: step.id.toString(),
        details: `Admin ${currentAdmin.username} started editing delivery step "${step.title}"`,
        page: 'DeliveryProcess',
        metadata: {
          stepId: step.id,
          stepTitle: step.title,
          action: 'edit_modal_opened',
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const handleEditModalClose = async () => {
    setShowEditModal(false);
    setEditingStep(null);
    setOriginalEditingStep(null);
    setTitle('');
    setDescription('');
    
    // Log edit modal closing
    if (currentAdmin && editingStep) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'delivery_edit_cancelled',
        entity_id: editingStep.id.toString(),
        details: `Admin ${currentAdmin.username} cancelled editing delivery step "${editingStep.title}"`,
        page: 'DeliveryProcess',
        metadata: {
          stepId: editingStep.id,
          stepTitle: editingStep.title,
          action: 'edit_cancelled',
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const saveEdit = async () => {
    if (!editingStep || !originalEditingStep || !currentAdmin) return;

    try {
      // Calculate changes for detailed logging
      const changes: Array<{field: string, oldValue: any, newValue: any}> = [];
      if (originalEditingStep.title !== title) {
        changes.push({ field: 'title', oldValue: originalEditingStep.title, newValue: title });
      }
      if (originalEditingStep.description !== description) {
        changes.push({ field: 'description', oldValue: originalEditingStep.description, newValue: description });
      }

      const { error } = await supabase
        .from('warranties')
        .update({ title, description })
        .eq('id', editingStep.id);

      if (!error) {
        // Enhanced activity logging for step update
        if (changes.length > 0) {
          const changesSummary = changes.map(c => `${c.field}: "${c.oldValue}" → "${c.newValue}"`);
          
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: "update",
            entity_type: "delivery_step",
            entity_id: editingStep.id.toString(),
            page: "DeliveryProcess",
            details: `Admin ${currentAdmin.username} updated delivery step "${originalEditingStep.title}" with ${changes.length} changes: ${changesSummary.join("; ")}`,
            metadata: {
              stepId: editingStep.id,
              originalTitle: originalEditingStep.title,
              newTitle: title,
              adminAccount: currentAdmin.username,
              adminId: currentAdmin.id,
              changesCount: changes.length,
              changes: changesSummary,
              detailedChanges: changes,
              timestamp: new Date().toISOString()
            }
          });

          // Log specific field changes
          for (const change of changes) {
            await logActivity({
              admin_id: currentAdmin.id,
              admin_name: currentAdmin.username,
              action: "update",
              entity_type: `delivery_step_${change.field}`,
              entity_id: editingStep.id.toString(),
              page: "DeliveryProcess",
              details: `Admin ${currentAdmin.username} updated delivery step ${change.field}: "${change.oldValue}" → "${change.newValue}"`,
              metadata: {
                stepId: editingStep.id,
                stepTitle: originalEditingStep.title,
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

        setEditingStep(null);
        setOriginalEditingStep(null);
        setTitle('');
        setDescription('');
        setShowEditModal(false);
        fetchSteps();
      } else {
        console.error("Error updating step:", error);
        
        // Log update error
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "update",
          entity_type: "delivery_step_error",
          entity_id: editingStep.id.toString(),
          details: `Admin ${currentAdmin.username} failed to update delivery step "${originalEditingStep.title}": ${error.message}`,
          page: "DeliveryProcess",
          metadata: {
            stepId: editingStep.id,
            stepTitle: originalEditingStep.title,
            error: error.message,
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      console.error("Exception updating step:", error);
      
      // Log update exception
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "update",
          entity_type: "delivery_step_exception",
          entity_id: editingStep?.id.toString() || 'unknown',
          details: `Admin ${currentAdmin.username} encountered error updating delivery step: ${error}`,
          page: "DeliveryProcess",
          metadata: {
            stepId: editingStep?.id,
            error: String(error),
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-black">Manage Delivery Process</h1>
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-600">
            Editing as: {currentAdmin?.username || 'Unknown Admin'}
          </div>
          <button
            onClick={handleAddModalOpen}
            className="bg-red-700 text-white px-4 py-2 rounded hover:bg-red-800"
          >
            Add Step
          </button>
        </div>
      </div>

      {/* Step List */}
      <div className="grid gap-4">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className="bg-white p-4 rounded shadow flex justify-between items-center"
          >
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs font-medium">
                  Step {index + 1}
                </span>
                <h3 className="font-bold text-black">{step.title}</h3>
              </div>
              <p className="text-gray-700">{step.description}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => startEdit(step)}
                className="text-blue-600 hover:underline"
              >
                Edit
              </button>
              <button
                onClick={() => deleteStep(step.id)}
                className="text-red-600 hover:underline"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {steps.length === 0 && (
        <div className="text-center py-8">
          <div className="text-4xl mb-4">📋</div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No delivery steps yet</h3>
          <p className="text-gray-500 mb-4">Add your first delivery process step to get started!</p>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg">
            <h2 className="text-xl font-bold mb-4 text-black">Add New Delivery Step</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-black mb-1">Step Title</label>
                <input
                  type="text"
                  placeholder="Enter step title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">Step Description</label>
                <textarea
                  placeholder="Enter step description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  rows={3}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={handleAddModalClose}
                className="px-4 py-2 rounded border hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={addStep}
                disabled={!title || !description}
                className="bg-red-700 text-white px-4 py-2 rounded hover:bg-red-800 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Add Step
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editingStep && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg">
            <h2 className="text-xl font-bold mb-4 text-black">Edit Delivery Step</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-black mb-1">Step Title</label>
                <input
                  type="text"
                  placeholder="Enter step title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-red-500 focus:border-red-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">Step Description</label>
                <textarea
                  placeholder="Enter step description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="border p-2 w-full rounded text-black focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  rows={3}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={handleEditModalClose}
                className="px-4 py-2 rounded border hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={!title || !description}
                className="bg-green-700 text-white px-4 py-2 rounded hover:bg-green-800 disabled:bg-gray-400 disabled:cursor-not-allowed"
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
