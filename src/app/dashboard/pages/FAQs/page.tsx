"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { PlusCircle, Trash2, Edit3, Save, X } from "lucide-react";
import { logActivity } from "@/app/lib/activity";

interface Category {
  id: number;
  name: string;
}

interface Question {
  id: number;
  category_id: number;
  question: string;
  answer: string;
}

export default function AdminFAQsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [newQuestions, setNewQuestions] = useState<
    Record<number, { question: string; answer: string }>
  >({});
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [originalEditingQuestion, setOriginalEditingQuestion] = useState<Question | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

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
            details: `Admin ${admin.username} accessed FAQs management page`,
            page: 'FAQs',
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
      fetchCategories();
      fetchQuestions();
    }
  }, [currentAdmin]);

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from("faq_categories")
        .select("*")
        .order("id");
      
      if (!error) {
        setCategories(data || []);
        
        // Log successful data load
        if (currentAdmin) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: 'faq_categories',
            details: `Admin ${currentAdmin.username} loaded ${data?.length || 0} FAQ categories`,
            page: 'FAQs',
            metadata: {
              categoriesCount: data?.length || 0,
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
            entity_type: 'faq_categories_error',
            details: `Admin ${currentAdmin.username} failed to load FAQ categories: ${error.message}`,
            page: 'FAQs',
            metadata: {
              error: error.message,
              adminAccount: currentAdmin.username,
              timestamp: new Date().toISOString()
            }
          });
        }
      }
    } catch (error) {
      console.error("Exception fetching categories:", error);
    }
  };

  const fetchQuestions = async () => {
    try {
      const { data, error } = await supabase
        .from("faq_questions")
        .select("*")
        .order("id");
      
      if (!error) {
        setQuestions(data || []);
        
        // Log successful data load
        if (currentAdmin) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: 'faq_questions',
            details: `Admin ${currentAdmin.username} loaded ${data?.length || 0} FAQ questions`,
            page: 'FAQs',
            metadata: {
              questionsCount: data?.length || 0,
              adminAccount: currentAdmin.username,
              adminId: currentAdmin.id,
              timestamp: new Date().toISOString()
            }
          });
        }
      } else {
        console.error(error);
      }
    } catch (error) {
      console.error("Exception fetching questions:", error);
    }
  };

  const addCategory = async () => {
    if (!newCategory || !currentAdmin) return;
    
    try {
      const { error } = await supabase
        .from("faq_categories")
        .insert([{ name: newCategory }]);
      
      if (!error) {
        // Enhanced activity logging for category creation
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "faq_category",
          details: `Admin ${currentAdmin.username} created new FAQ category "${newCategory}"`,
          page: "FAQs",
          metadata: {
            categoryName: newCategory,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });

        setNewCategory("");
        fetchCategories();
      } else {
        console.error(error);
        
        // Log add error
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "faq_category_error",
          details: `Admin ${currentAdmin.username} failed to create FAQ category "${newCategory}": ${error.message}`,
          page: "FAQs",
          metadata: {
            categoryName: newCategory,
            error: error.message,
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      console.error("Exception adding category:", error);
    }
  };

  const deleteCategory = async (id: number) => {
    if (!currentAdmin) return;

    const categoryToDelete = categories.find(c => c.id === id);
    
    if (!confirm(`Are you sure you want to delete the category "${categoryToDelete?.name}"? This will also delete all questions in this category.`)) {
      // Log deletion cancelled
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'faq_category_delete_cancelled',
        entity_id: id.toString(),
        details: `Admin ${currentAdmin.username} cancelled deletion of FAQ category "${categoryToDelete?.name}"`,
        page: 'FAQs',
        metadata: {
          categoryId: id,
          categoryName: categoryToDelete?.name,
          action: 'delete_cancelled',
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("faq_categories")
        .delete()
        .eq("id", id);
      
      if (!error) {
        // Enhanced activity logging for category deletion
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "delete",
          entity_type: "faq_category",
          entity_id: id.toString(),
          details: `Admin ${currentAdmin.username} deleted FAQ category "${categoryToDelete?.name}"`,
          page: "FAQs",
          metadata: {
            categoryId: id,
            deletedCategory: {
              name: categoryToDelete?.name
            },
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            remainingCategoriesCount: categories.length - 1,
            timestamp: new Date().toISOString()
          }
        });

        fetchCategories();
        fetchQuestions();
      } else {
        console.error(error);
      }
    } catch (error) {
      console.error("Exception deleting category:", error);
    }
  };

  const handleNewQuestionChange = (
    catId: number,
    field: "question" | "answer",
    value: string
  ) => {
    setNewQuestions((prev) => ({
      ...prev,
      [catId]: {
        ...prev[catId],
        [field]: value,
      },
    }));
    setDirty(true);
  };

  const addQuestion = async (categoryId: number) => {
    const q = newQuestions[categoryId];
    if (!q || !q.question || !q.answer || !currentAdmin) return;
    
    const categoryName = categories.find(c => c.id === categoryId)?.name;
    
    try {
      const { data, error } = await supabase.from("faq_questions").insert([
        { category_id: categoryId, question: q.question, answer: q.answer },
      ]).select();
      
      if (!error && data) {
        // Enhanced activity logging for question creation
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "faq_question",
          entity_id: data[0].id.toString(),
          details: `Admin ${currentAdmin.username} added FAQ question "${q.question}" to category "${categoryName}"`,
          page: "FAQs",
          metadata: {
            questionId: data[0].id,
            categoryId: categoryId,
            categoryName: categoryName,
            question: q.question,
            answer: q.answer,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });

        setNewQuestions((prev) => ({
          ...prev,
          [categoryId]: { question: "", answer: "" },
        }));
        fetchQuestions();
        setDirty(false);
      } else {
        console.error(error);
      }
    } catch (error) {
      console.error("Exception adding question:", error);
    }
  };

  const startEditQuestion = async (question: Question) => {
    setEditingQuestion(question);
    setOriginalEditingQuestion(JSON.parse(JSON.stringify(question))); // Deep copy
    
    // Log edit initiation
    if (currentAdmin) {
      const categoryName = categories.find(c => c.id === question.category_id)?.name;
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'faq_question_edit_start',
        entity_id: question.id.toString(),
        details: `Admin ${currentAdmin.username} started editing FAQ question "${question.question}"`,
        page: 'FAQs',
        metadata: {
          questionId: question.id,
          categoryName: categoryName,
          originalQuestion: question.question,
          action: 'edit_started',
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const saveEditQuestion = async () => {
    if (!editingQuestion || !originalEditingQuestion || !currentAdmin) return;

    try {
      // Calculate changes for detailed logging
      const changes: Array<{field: string, oldValue: any, newValue: any}> = [];
      if (originalEditingQuestion.question !== editingQuestion.question) {
        changes.push({ field: 'question', oldValue: originalEditingQuestion.question, newValue: editingQuestion.question });
      }
      if (originalEditingQuestion.answer !== editingQuestion.answer) {
        changes.push({ field: 'answer', oldValue: originalEditingQuestion.answer, newValue: editingQuestion.answer });
      }

      const { error } = await supabase
        .from("faq_questions")
        .update({
          question: editingQuestion.question,
          answer: editingQuestion.answer,
        })
        .eq("id", editingQuestion.id);

      if (!error) {
        const categoryName = categories.find(c => c.id === editingQuestion.category_id)?.name;
        
        // Enhanced activity logging for question update
        if (changes.length > 0) {
          const changesSummary = changes.map(c => `${c.field}: "${c.oldValue}" → "${c.newValue}"`);
          
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: "update",
            entity_type: "faq_question",
            entity_id: editingQuestion.id.toString(),
            details: `Admin ${currentAdmin.username} updated FAQ question in "${categoryName}" with ${changes.length} changes: ${changesSummary.slice(0, 1).join("; ")}${changesSummary.length > 1 ? "..." : ""}`,
            page: "FAQs",
            metadata: {
              questionId: editingQuestion.id,
              categoryName: categoryName,
              originalQuestion: originalEditingQuestion.question,
              newQuestion: editingQuestion.question,
              adminAccount: currentAdmin.username,
              adminId: currentAdmin.id,
              changesCount: changes.length,
              changes: changesSummary,
              detailedChanges: changes,
              timestamp: new Date().toISOString()
            }
          });
        }

        setEditingQuestion(null);
        setOriginalEditingQuestion(null);
        fetchQuestions();
      } else {
        console.error(error);
      }
    } catch (error) {
      console.error("Exception updating question:", error);
    }
  };

  const cancelEditQuestion = async () => {
    if (currentAdmin && editingQuestion) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'faq_question_edit_cancelled',
        entity_id: editingQuestion.id.toString(),
        details: `Admin ${currentAdmin.username} cancelled editing FAQ question "${editingQuestion.question}"`,
        page: 'FAQs',
        metadata: {
          questionId: editingQuestion.id,
          originalQuestion: editingQuestion.question,
          action: 'edit_cancelled',
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    setEditingQuestion(null);
    setOriginalEditingQuestion(null);
  };

  const deleteQuestion = async (id: number) => {
    if (!currentAdmin) return;

    const questionToDelete = questions.find(q => q.id === id);
    const categoryName = categories.find(c => c.id === questionToDelete?.category_id)?.name;
    
    if (!confirm(`Are you sure you want to delete this question: "${questionToDelete?.question}"?`)) {
      // Log deletion cancelled
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'faq_question_delete_cancelled',
        entity_id: id.toString(),
        details: `Admin ${currentAdmin.username} cancelled deletion of FAQ question "${questionToDelete?.question}"`,
        page: 'FAQs',
        metadata: {
          questionId: id,
          question: questionToDelete?.question,
          categoryName: categoryName,
          action: 'delete_cancelled',
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("faq_questions")
        .delete()
        .eq("id", id);
      
      if (!error) {
        // Enhanced activity logging for question deletion
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "delete",
          entity_type: "faq_question",
          entity_id: id.toString(),
          details: `Admin ${currentAdmin.username} deleted FAQ question "${questionToDelete?.question}" from category "${categoryName}"`,
          page: "FAQs",
          metadata: {
            questionId: id,
            deletedQuestion: {
              question: questionToDelete?.question,
              answer: questionToDelete?.answer,
              categoryName: categoryName
            },
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            remainingQuestionsCount: questions.length - 1,
            timestamp: new Date().toISOString()
          }
        });

        fetchQuestions();
      } else {
        console.error(error);
      }
    } catch (error) {
      console.error("Exception deleting question:", error);
    }
  };

  const handleSave = async () => {
    if (!dirty) return;
    const confirmed = confirm("Save changes?");
    if (!confirmed) return;

    setSaving(true);
    await fetchQuestions();
    setSaving(false);
    setDirty(false);
    alert("Changes saved to Supabase ✅");
  };

  return (
    <div className="p-8 max-w-5xl mx-auto bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">FAQ Management</h1>
        <div className="text-sm text-gray-600">
          Editing as: {currentAdmin?.username || 'Unknown Admin'}
        </div>
      </div>

      {/* Add Category */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New Category</h2>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="New Category Name"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-800"
          />
          <button
            onClick={addCategory}
            disabled={!newCategory}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg shadow transition-colors disabled:cursor-not-allowed"
          >
            <PlusCircle size={18} />
            Add Category
          </button>
        </div>
      </div>

      {/* Categories */}
      <div className="space-y-6">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="bg-white border border-gray-200 rounded-xl shadow-sm p-6"
          >
            {/* Category header */}
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
                <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
                  {questions.filter(q => q.category_id === cat.id).length} questions
                </span>
                {cat.name}
              </h2>
              <button
                onClick={() => deleteCategory(cat.id)}
                className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg transition-colors"
                title="Delete Category"
              >
                <Trash2 size={20} />
              </button>
            </div>

            {/* Add Question Form */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <h3 className="font-medium text-gray-900 mb-3">Add New Question</h3>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Enter question..."
                  value={newQuestions[cat.id]?.question || ""}
                  onChange={(e) =>
                    handleNewQuestionChange(cat.id, "question", e.target.value)
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-800"
                />
                <textarea
                  placeholder="Enter answer..."
                  rows={3}
                  value={newQuestions[cat.id]?.answer || ""}
                  onChange={(e) =>
                    handleNewQuestionChange(cat.id, "answer", e.target.value)
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-800"
                />
                <button
                  onClick={() => addQuestion(cat.id)}
                  disabled={!newQuestions[cat.id]?.question || !newQuestions[cat.id]?.answer}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg shadow transition-colors disabled:cursor-not-allowed"
                >
                  + Add Question
                </button>
              </div>
            </div>

            {/* Questions */}
            <div className="space-y-3">
              {questions
                .filter((q) => q.category_id === cat.id)
                .map((q) => (
                  <div
                    key={q.id}
                    className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
                  >
                    {editingQuestion?.id === q.id ? (
                      // Edit Mode
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={editingQuestion.question}
                          onChange={(e) =>
                            setEditingQuestion({
                              ...editingQuestion,
                              question: e.target.value,
                            })
                          }
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 font-medium text-gray-800 focus:ring-2 focus:ring-blue-500"
                        />
                        <textarea
                          value={editingQuestion.answer}
                          onChange={(e) =>
                            setEditingQuestion({
                              ...editingQuestion,
                              answer: e.target.value,
                            })
                          }
                          rows={3}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-600 focus:ring-2 focus:ring-blue-500"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={cancelEditQuestion}
                            className="flex items-center gap-1 text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded"
                          >
                            <X size={16} />
                            Cancel
                          </button>
                          <button
                            onClick={saveEditQuestion}
                            className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded"
                          >
                            <Save size={16} />
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      // View Mode
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 mb-2">{q.question}</p>
                          <p className="text-gray-600 text-sm leading-relaxed">{q.answer}</p>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => startEditQuestion(q)}
                            className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 p-1 rounded"
                            title="Edit Question"
                          >
                            <Edit3 size={16} />
                          </button>
                          <button
                            onClick={() => deleteQuestion(q.id)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded"
                            title="Delete Question"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              
              {questions.filter((q) => q.category_id === cat.id).length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <div className="text-4xl mb-2">❓</div>
                  <p>No questions in this category yet</p>
                  <p className="text-sm">Add your first question above</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {categories.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <div className="text-6xl mb-4">❓</div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No FAQ categories yet</h3>
          <p className="text-gray-500 mb-4">Create your first FAQ category to get started!</p>
        </div>
      )}

      {/* Save Button */}
      <div className="mt-8 text-right">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className={`px-6 py-3 rounded-lg font-semibold shadow transition ${
            dirty
              ? "bg-green-600 text-white hover:bg-green-700"
              : "bg-gray-300 text-gray-600 cursor-not-allowed"
          }`}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
