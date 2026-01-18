import { useState, useEffect } from "react";
import axios from "axios";
import { Upload, FileText, MessageSquare, Trash2, File, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator"; 

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Dashboard = () => {
  const [documents, setDocuments] = useState([]);
  const [chatHistory, setChatHistory] = useState([]);
  const [question, setQuestion] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [currentAnswer, setCurrentAnswer] = useState(null);

  useEffect(() => {
    fetchDocuments();
    fetchChatHistory();
  }, []);

  const fetchDocuments = async () => {
    try {
      const response = await axios.get(`${API}/documents`);
      setDocuments(response.data);
    } catch (error) {
      console.error("Error fetching documents:", error);
    }
  };

  const fetchChatHistory = async () => {
    try {
      const response = await axios.get(`${API}/chat/history`);
      setChatHistory(response.data);
    } catch (error) {
      console.error("Error fetching chat history:", error);
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setIsUploading(true);
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));

    try {
      const response = await axios.post(`${API}/documents/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      // Show success for uploaded files
      if (response.data.uploaded > 0) {
        toast.success(`${response.data.uploaded} document(s) uploaded successfully`);
      }
      
      // Show warnings for failed files
      if (response.data.failed > 0) {
        response.data.failed_files.forEach(failed => {
          toast.error(`${failed.filename}: ${failed.error}`);
        });
      }
      
      fetchDocuments();
    } catch (error) {
      // Handle complete failure
      if (error.response?.data?.detail?.failed_files) {
        error.response.data.detail.failed_files.forEach(failed => {
          toast.error(`${failed.filename}: ${failed.error}`);
        });
      } else if (error.response?.data?.detail) {
        toast.error(error.response.data.detail);
      } else {
        toast.error("Failed to upload documents");
      }
      console.error("Upload error:", error);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteDocument = async (docId) => {
    try {
      await axios.delete(`${API}/documents/${docId}`);
      toast.success("Document deleted successfully");
      fetchDocuments();
    } catch (error) {
      toast.error("Failed to delete document");
      console.error("Delete error:", error);
    }
  };

  const handleAskQuestion = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;

    setIsAsking(true);
    try {
      const response = await axios.post(`${API}/chat`, { question });
      setCurrentAnswer({
        question,
        answer: response.data.answer,
        sources: response.data.sources
      });
      setQuestion("");
      fetchChatHistory();
    } catch (error) {
      toast.error("Failed to get answer");
      console.error("Chat error:", error);
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/40">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/90 backdrop-blur-md shadow-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-heading font-extrabold text-2xl tracking-tight text-foreground" data-testid="app-title">
                Enterprise Knowledge Base
              </h1>
              <p className="text-sm text-muted-foreground mt-1">Grounded document synthesis engine</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="file"
                id="file-upload"
                multiple
                accept=".pdf"
                onChange={handleFileUpload}
                className="hidden"
                data-testid="file-input"
              />
              <Button
                onClick={() => document.getElementById('file-upload').click()}
                disabled={isUploading}
                data-testid="upload-button"
                className="rounded-md font-medium transition-all active:scale-95 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload PDFs
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Sidebar - Documents */}
          <div className="lg:col-span-3" data-testid="documents-sidebar">
            <Card className="rounded-xl border bg-card text-card-foreground shadow-md">
              <CardHeader>
                <CardTitle className="font-heading font-semibold text-xl tracking-tight flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Documents
                </CardTitle>
                <CardDescription className="font-sans text-sm text-muted-foreground">
                  {documents.length} uploaded
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[calc(100vh-300px)]">
                  {documents.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground" data-testid="no-documents-message">
                      <File className="mx-auto h-12 w-12 mb-3 opacity-30" />
                      <p className="text-sm">No documents uploaded yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {documents.map((doc) => (
                        <div
                          key={doc.id}
                          data-testid={`document-item-${doc.id}`}
                          className="group p-3 rounded-lg border bg-card hover:bg-accent transition-all duration-200 shadow-sm hover:shadow-md"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate" data-testid="document-filename">
                                {doc.filename}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {doc.num_chunks} chunks
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteDocument(doc.id)}
                              data-testid={`delete-document-${doc.id}`}
                              className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Main Chat Area */}
          <div className="lg:col-span-9">
            <Tabs defaultValue="chat" className="w-full">
              <TabsList className="grid w-full grid-cols-2 max-w-md">
                <TabsTrigger value="chat" data-testid="chat-tab">Chat</TabsTrigger>
                <TabsTrigger value="history" data-testid="history-tab">History</TabsTrigger>
              </TabsList>

              <TabsContent value="chat" className="mt-6" data-testid="chat-content">
                <Card className="rounded-xl border bg-card text-card-foreground shadow-md">
                  <CardHeader>
                    <CardTitle className="font-heading font-bold text-2xl tracking-tight">
                      Ask a Question
                    </CardTitle>
                    <CardDescription className="font-sans text-base leading-relaxed text-foreground/80">
                      Get grounded answers from your uploaded documents
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleAskQuestion} className="space-y-4">
                      <div className="flex gap-2">
                        <Input
                          placeholder="What would you like to know?"
                          value={question}
                          onChange={(e) => setQuestion(e.target.value)}
                          disabled={isAsking || documents.length === 0}
                          data-testid="question-input"
                          className="flex-1"
                        />
                        <Button
                          type="submit"
                          disabled={isAsking || !question.trim() || documents.length === 0}
                          data-testid="ask-button"
                          className="rounded-md font-medium transition-all active:scale-95 bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
                          >
                          {isAsking ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <MessageSquare className="mr-2 h-4 w-4" />
                              Ask
                            </>
                          )}
                        </Button>
                      </div>
                    </form>

                    {currentAnswer && (
                      <div className="mt-6 space-y-4" data-testid="current-answer">
                        <Separator />
                        <div>
                          <h3 className="font-heading font-semibold text-lg mb-2 text-foreground">
                            Question:
                          </h3>
                          <p className="text-foreground/80" data-testid="answer-question">{currentAnswer.question}</p>
                        </div>
                        <div>
                          <h3 className="font-heading font-semibold text-lg mb-2 text-foreground">
                            Answer:
                          </h3>
                          <div className="bg-muted p-4 rounded-lg shadow-inner">
                            <p className="text-foreground/90 whitespace-pre-wrap" data-testid="answer-text">
                              {currentAnswer.answer}
                            </p>
                          </div>
                        </div>
                        {currentAnswer.sources && currentAnswer.sources.length > 0 && (
                          <div>
                            <h3 className="font-heading font-semibold text-lg mb-2 text-foreground">
                              Sources:
                            </h3>
                            <div className="space-y-2">
                              {currentAnswer.sources.map((source, idx) => (
                                <div
                                  key={idx}
                                  data-testid={`source-${idx}`}
                                  className="p-3 bg-secondary rounded-md border"
                                >
                                  <p className="text-sm font-medium text-foreground">
                                    {source.filename} {source.page > 0 && `(Page ${source.page})`}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                    {source.text}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="history" className="mt-6" data-testid="history-content">
                <Card className="rounded-lg border bg-card text-card-foreground shadow-sm">
                  <CardHeader>
                    <CardTitle className="font-heading font-bold text-2xl tracking-tight">
                      Chat History
                    </CardTitle>
                    <CardDescription className="font-sans text-base leading-relaxed text-foreground/80">
                      Previous questions and answers
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[calc(100vh-300px)]">
                      {chatHistory.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground" data-testid="no-history-message">
                          <MessageSquare className="mx-auto h-12 w-12 mb-3 opacity-30" />
                          <p className="text-sm">No chat history yet</p>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          {chatHistory.map((item, idx) => (
                            <div
                              key={item.id}
                              data-testid={`history-item-${idx}`}
                              className="p-4 rounded-lg border bg-card shadow-sm hover:shadow-md transition-shadow duration-200"
                            >
                              <div className="space-y-3">
                                <div>
                                  <p className="text-xs text-muted-foreground mb-1">
                                    {new Date(item.timestamp).toLocaleString()}
                                  </p>
                                  <p className="font-medium text-foreground" data-testid="history-question">
                                    Q: {item.question}
                                  </p>
                                </div>
                                <div className="bg-muted p-3 rounded-md">
                                  <p className="text-sm text-foreground/90" data-testid="history-answer">
                                    {item.answer}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {item.sources.map((source, sIdx) => (
                                    <span
                                      key={sIdx}
                                      data-testid={`history-source-${idx}-${sIdx}`}
                                      className="inline-flex items-center px-2 py-1 rounded-md bg-secondary text-xs font-medium"
                                    >
                                      <File className="h-3 w-3 mr-1" />
                                      {source}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
