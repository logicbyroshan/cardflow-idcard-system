from pydantic import BaseModel, EmailStr
from typing import Optional

class CreateClientDTO(BaseModel):
    email: EmailStr
    username: str
    password: str
    organization_id: str

class CreateAssistantDTO(BaseModel):
    email: EmailStr
    username: str
    password: str
    parent_client_id: str
