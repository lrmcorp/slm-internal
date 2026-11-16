import unittest
import numpy as np
from worker import Worker
class TrackOverlayTest(unittest.TestCase):
    def test_objects_and_people_have_distinct_overlays_but_only_people_enter_presence_reports(self):
        worker=Worker.__new__(Worker)
        frame=np.zeros((100,100,3),dtype=np.uint8)
        detections=[{'class':'person','id':1,'box':[.1,.1,.3,.3]},
                    {'class':'item','id':7,'box':[.5,.5,.8,.8]},
                    {'class':'person','id':None,'box':[.85,.85,.95,.95]}]
        image,people=worker.draw_tracks(frame,detections)
        self.assertEqual(people,[{'id':'1','box':[.1,.1,.3,.3]}])
        self.assertEqual(image[30,20].tolist(),[0,220,255])
        self.assertEqual(image[80,65].tolist(),[140,240,70])
        self.assertFalse(frame.any())
if __name__=='__main__':unittest.main()
