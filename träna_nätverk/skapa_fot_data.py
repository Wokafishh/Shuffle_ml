"""
Inputs: 

Först, skapa ett ui som visar en video utan ljud och hävisar användaren att
klicka på mellanslag när dansaren är vid maximal utsträckning (Heltakter). 
Returnera i JSON tidsmarkörer.

Härled bpm utifrån en sträng av många klick i rad. 
Eftersom att klick bara sker på heltakter kan vi även härleda halvtakter.
Heltakt Inget klick = Negativ spark
Halftakt = Negativ spark också
Heltakt + klick = Positiv spark.
Skapa JSON filer av MediaPipe rörelsedata 5 frames bak och fram från
sparken. 
"""

