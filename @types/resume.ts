export interface ResumeData {
  meta: {
    version: string;
    lastUpdated: string;
  };
  contact: {
    name: string;
    phone: string;
    email: string;
    linkedin: string;
    location: string;
  };
  summary: string;
  skills: string[];
  experience: Experience[];
  education: Education[];
}

export interface Experience {
  company: string;
  title: string;
  startDate: string;
  endDate: string | null;
  highlights: string[];
}

export interface Education {
  institution: string;
  degree: string;
  startDate: string;
  endDate: string;
}
