Set stream = CreateObject("ADODB.Stream")
stream.Type = 1
stream.Open
stream.LoadFromFile "C:\PostgreSQL\data\base.tar"

content = stream.Read
stream.Close

 Const BLOCK_SIZE = 512
 headerPos = 0
 found = False
 Do While headerPos < LenB(content) - BLOCK_SIZE
     header = MidB(content, headerPos + 1, BLOCK_SIZE)
     name = ""
     For i = 1 To 100
         b = AscB(MidB(header, i, 1))
         If b = 0 Then Exit For
         name = name & Chr(b)
     Next
     name = Trim(name)
     
     sizeOct = ""
     For i = 125 To 135
         b = AscB(MidB(header, i, 1))
         If b = 0 Then Exit For
         sizeOct = sizeOct & Chr(b)
     Next
     sizeOct = Trim(sizeOct)
     size = CLng("&o" & sizeOct)
     
     If name = "backup_label" Then
         WScript.Echo "Found backup_label at offset " & headerPos & ", size " & size
         dataStart = headerPos + BLOCK_SIZE
         dataEnd = dataStart + size
         data = MidB(content, dataStart + 1, size)
         
         Set out = CreateObject("ADODB.Stream")
         out.Type = 1
         out.Open
         out.Write data
         out.SaveToFile "C:\PostgreSQL\data\backup_label", 2
         out.Close
         WScript.Echo "Extracted backup_label"
         found = True
         Exit Do
     End If
     
     headerPos = headerPos + BLOCK_SIZE + ((size + BLOCK_SIZE - 1) \ BLOCK_SIZE) * BLOCK_SIZE
 Loop

If Not found Then WScript.Echo "backup_label not found in tar"
